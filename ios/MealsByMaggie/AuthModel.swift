import Foundation
import Combine
import Amplify
import AWSCognitoAuthPlugin
import AWSPluginsCore

// Cognito sign-in state, the Swift counterpart of useCognitoAuth.ts in mbm-ui.
// Uses the same user pool and app client as the web app (SRP auth), configured
// from amplifyconfiguration.json. Emails are used as the Cognito username,
// matching the web Authenticator.
@Observable
final class AuthModel {
    enum State { case loading, signedOut, signedIn }

    enum SignInOutcome { case signedIn, needsConfirmation }

    private(set) var state: State = .loading
    private(set) var email: String?
    private(set) var nickname: String?
    private(set) var userSub: String?

    var isSignedIn: Bool { state == .signedIn }

    /// What to call the user: their kitchen nickname, else their email.
    var displayName: String? {
        if let nickname, !nickname.isEmpty { return nickname }
        return email
    }

    static func configureAmplify() {
        do {
            try Amplify.add(plugin: AWSCognitoAuthPlugin())
            try Amplify.configure()
        } catch {
            print("Amplify configuration failed: \(error)")
        }
    }

    init() {
        // Keep state in sync if the session expires or is signed out elsewhere.
        Task { [weak self] in
            for await payload in Amplify.Hub.publisher(for: .auth).values {
                let event = payload.eventName
                if event == HubPayload.EventName.Auth.signedOut || event == HubPayload.EventName.Auth.sessionExpired {
                    self?.clear()
                }
            }
        }
    }

    /// Checks for a saved session (Amplify keeps it in the Keychain between launches).
    func refresh() async {
        do {
            let session = try await Amplify.Auth.fetchAuthSession()
            guard session.isSignedIn else { return clear() }
            await loadAttributes()
            state = .signedIn
        } catch {
            clear()
        }
    }

    func signIn(email: String, password: String) async throws -> SignInOutcome {
        let result = try await Amplify.Auth.signIn(username: normalized(email), password: password)
        switch result.nextStep {
        case .done:
            await refresh()
            return .signedIn
        case .confirmSignUp:
            return .needsConfirmation
        default:
            throw AuthModelError.unsupportedStep
        }
    }

    /// Creates an account; Cognito then emails a 6-digit code to confirm it.
    func signUp(email: String, password: String, nickname: String, inviteCode: String) async throws {
        var attributes = [
            AuthUserAttribute(.email, value: normalized(email)),
            AuthUserAttribute(.custom("invite"), value: inviteCode.trimmingCharacters(in: .whitespaces)),
        ]
        let name = nickname.trimmingCharacters(in: .whitespaces)
        if !name.isEmpty {
            attributes.append(AuthUserAttribute(.nickname, value: name))
        }
        _ = try await Amplify.Auth.signUp(
            username: normalized(email),
            password: password,
            options: .init(userAttributes: attributes)
        )
    }

    func confirmSignUp(email: String, code: String) async throws {
        _ = try await Amplify.Auth.confirmSignUp(
            for: normalized(email),
            confirmationCode: code.trimmingCharacters(in: .whitespaces)
        )
    }

    func resendCode(email: String) async throws {
        _ = try await Amplify.Auth.resendSignUpCode(for: normalized(email))
    }

    func signOut() async {
        _ = await Amplify.Auth.signOut()
        clear()
    }

    /// ID token for the API's `Authorization: Bearer` header, refreshed if needed.
    func idToken() async -> String? {
        guard let session = try? await Amplify.Auth.fetchAuthSession(),
              let provider = session as? AuthCognitoTokensProvider,
              let tokens = try? provider.getCognitoTokens().get() else { return nil }
        return tokens.idToken
    }

    private func loadAttributes() async {
        guard let attributes = try? await Amplify.Auth.fetchUserAttributes() else { return }
        for attribute in attributes {
            switch attribute.key {
            case .email: email = attribute.value
            case .nickname: nickname = attribute.value
            case .sub: userSub = attribute.value
            default: break
            }
        }
    }

    private func clear() {
        state = .signedOut
        email = nil
        nickname = nil
        userSub = nil
    }

    private func normalized(_ email: String) -> String {
        // Trim only: the web app doesn't lowercase, and Cognito usernames can be case-sensitive.
        email.trimmingCharacters(in: .whitespaces)
    }
}

enum AuthModelError: LocalizedError {
    case unsupportedStep

    var errorDescription: String? {
        "This account needs a sign-in step the app doesn't support yet. Try the website."
    }
}

/// Kitchen-friendly wording for the Cognito errors people actually hit.
func friendlyAuthMessage(_ error: Error) -> String {
    guard let authError = error as? AuthError else { return error.localizedDescription }
    if let cognito = authError.underlyingError as? AWSCognitoAuthError {
        switch cognito {
        case .userNotFound:
            return "That email and password don’t match. Try again?"
        case .usernameExists:
            return "There’s already an account with that email. Try signing in instead."
        case .codeMismatch:
            return "That code doesn’t match. Check your email and try again."
        case .codeExpired:
            return "That code has gone stale. Tap “Send a new code”."
        case .invalidPassword:
            return "Passwords need at least 8 characters, with an uppercase letter, a lowercase letter and a number."
        case .lambda:
            return "That invite code didn’t work. Double-check it with whoever invited you."
        case .limitExceeded, .requestLimitExceeded, .failedAttemptsLimitExceeded:
            return "Too many tries. Let it rest a few minutes, like good dough."
        case .network:
            return "Can’t reach the kitchen. Check your connection."
        default:
            break
        }
    }
    if case .notAuthorized = authError {
        return "That email and password don’t match. Try again?"
    }
    return authError.errorDescription
}
