import SwiftUI

// Sign in / create account / confirm email, replacing the web's Amplify
// Authenticator (LoginModal.tsx). Sign-up asks for the same fields: invite
// code, kitchen nickname, email and password.
struct LoginView: View {
    @Environment(AuthModel.self) private var auth
    @Environment(\.dismiss) private var dismiss

    private enum Mode { case signIn, signUp, confirm }

    @State private var mode: Mode = .signIn
    @State private var email = ""
    @State private var password = ""
    @State private var nickname = ""
    @State private var inviteCode = ""
    @State private var code = ""
    @State private var errorMessage: String?
    @State private var notice: String?
    @State private var isWorking = false
    @State private var title = ["Welcome back to the kitchen!", "Aprons on!", "The kitchen’s open"].randomElement()!
    /// Signed in, but the account has no kitchen nickname yet.
    @State private var askForNickname = false

    var body: some View {
        if askForNickname {
            NicknamePrompt()
        } else {
            form
        }
    }

    private var form: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(heading)
                        .font(.poppins(24))
                        .foregroundStyle(Color.plum)
                    if let subheading {
                        Text(subheading)
                            .font(.inter(15))
                            .foregroundStyle(Color.muted)
                    }

                    fields
                        .padding(.top, 6)

                    if let errorMessage {
                        Text(errorMessage)
                            .font(.inter(14, weight: .medium))
                            .foregroundStyle(Color(hex: 0x8A4A0C))
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(hex: 0xFDF0DC), in: RoundedRectangle(cornerRadius: 12))
                    }
                    if let notice {
                        Text(notice)
                            .font(.inter(14, weight: .medium))
                            .foregroundStyle(Color.ok)
                    }

                    Button(action: submit) {
                        if isWorking {
                            ProgressView().tint(.white)
                        } else {
                            Text(primaryTitle)
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(isWorking || !canSubmit)
                    .opacity(canSubmit ? 1 : 0.4)
                    .padding(.top, 4)

                    secondaryActions
                }
                .padding(20)
            }
            .background(Color.appBackground)
            .scrollDismissesKeyboard(.interactively)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                }
            }
        }
    }

    private var heading: String {
        switch mode {
        case .signIn: title
        case .signUp: "Join the kitchen"
        case .confirm: "Check your email"
        }
    }

    private var subheading: String? {
        switch mode {
        case .signIn: nil
        case .signUp: "You’ll need an invite code to sign up."
        case .confirm: "We sent a 6-digit code to \(email.trimmingCharacters(in: .whitespaces))."
        }
    }

    @ViewBuilder
    private var fields: some View {
        switch mode {
        case .signIn:
            ThemedField(title: "Email", text: $email, kind: .email)
            ThemedField(title: "Password", text: $password, kind: .password)
        case .signUp:
            ThemedField(title: "Invite code", text: $inviteCode, kind: .plain)
            ThemedField(title: "What should we call you in the kitchen?", text: $nickname, kind: .name)
            ThemedField(title: "Email", text: $email, kind: .email)
            ThemedField(title: "Password", text: $password, kind: .newPassword)
            Text("At least 8 characters, with an uppercase letter, a lowercase letter and a number.")
                .font(.inter(12.5))
                .foregroundStyle(Color.muted)
        case .confirm:
            ThemedField(title: "Code", text: $code, kind: .oneTimeCode)
        }
    }

    @ViewBuilder
    private var secondaryActions: some View {
        switch mode {
        case .signIn:
            LinkButton(title: "New here? Create an account") { switchMode(.signUp) }
        case .signUp:
            LinkButton(title: "Already have an account? Sign in") { switchMode(.signIn) }
        case .confirm:
            LinkButton(title: "Send a new code", action: resend)
            LinkButton(title: "Back to sign in") { switchMode(.signIn) }
        }
    }

    private var primaryTitle: String {
        switch mode {
        case .signIn: "Sign in"
        case .signUp: "Create account"
        case .confirm: "Confirm"
        }
    }

    private var canSubmit: Bool {
        let hasEmail = !email.trimmingCharacters(in: .whitespaces).isEmpty
        switch mode {
        case .signIn: return hasEmail && !password.isEmpty
        case .signUp: return hasEmail && password.count >= 8 && !inviteCode.trimmingCharacters(in: .whitespaces).isEmpty
        case .confirm: return code.trimmingCharacters(in: .whitespaces).count >= 6
        }
    }

    private func switchMode(_ newMode: Mode) {
        errorMessage = nil
        notice = nil
        withAnimation(.easeOut(duration: 0.2)) { mode = newMode }
    }

    private func submit() {
        guard canSubmit, !isWorking else { return }
        errorMessage = nil
        notice = nil
        isWorking = true
        Task {
            defer { isWorking = false }
            do {
                switch mode {
                case .signIn:
                    switch try await auth.signIn(email: email, password: password) {
                    case .signedIn: finishSignIn()
                    case .needsConfirmation: switchMode(.confirm)
                    }
                case .signUp:
                    try await auth.signUp(email: email, password: password, nickname: nickname, inviteCode: inviteCode)
                    switchMode(.confirm)
                case .confirm:
                    try await auth.confirmSignUp(email: email, code: code)
                    if case .signedIn = try await auth.signIn(email: email, password: password) {
                        finishSignIn()
                    }
                }
            } catch {
                errorMessage = friendlyAuthMessage(error)
            }
        }
    }

    private func finishSignIn() {
        if auth.nickname?.isEmpty ?? true {
            withAnimation { askForNickname = true }
        } else {
            dismiss()
        }
    }

    private func resend() {
        Task {
            do {
                try await auth.resendCode(email: email)
                errorMessage = nil
                notice = "A fresh code is on its way."
            } catch {
                errorMessage = friendlyAuthMessage(error)
            }
        }
    }
}

/// Labeled white input matching the web form fields.
private struct ThemedField: View {
    enum Kind { case plain, name, email, password, newPassword, oneTimeCode }

    let title: String
    @Binding var text: String
    let kind: Kind

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.inter(13, weight: .semibold))
                .foregroundStyle(Color.text)
            Group {
                if kind == .password || kind == .newPassword {
                    SecureField("", text: $text)
                } else {
                    TextField("", text: $text)
                }
            }
            .font(.inter(16))
            .foregroundStyle(Color.text)
            .textContentType(contentType)
            .keyboardType(kind == .email ? .emailAddress : kind == .oneTimeCode ? .numberPad : .default)
            .textInputAutocapitalization(kind == .name ? .words : .never)
            .autocorrectionDisabled()
            .padding(.horizontal, 14)
            .frame(height: 48)
            .background(Color.surface, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Color.line))
        }
    }

    /// Lets iOS offer saved passwords, suggest strong ones, and autofill email codes.
    private var contentType: UITextContentType? {
        switch kind {
        case .plain: nil
        case .name: .nickname
        case .email: .username
        case .password: .password
        case .newPassword: .newPassword
        case .oneTimeCode: .oneTimeCode
        }
    }
}

private struct LinkButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(title, action: action)
            .font(.inter(15, weight: .semibold))
            .foregroundStyle(Color.plum)
            .frame(maxWidth: .infinity, minHeight: 44)
    }
}

/// "What should we call you in the kitchen?" for accounts without a nickname
/// (CompleteProfile.tsx). Recipes are signed "By <nickname>".
struct NicknamePrompt: View {
    @Environment(AuthModel.self) private var auth
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var isSaving = false
    @State private var errorMessage: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(auth.nickname == nil ? "Complete your profile" : "Your kitchen name")
                .font(.poppins(22))
                .foregroundStyle(Color.plum)
            Text("What should we call you in the kitchen? It’s shown on the recipes you add.")
                .font(.inter(15))
                .foregroundStyle(Color.muted)
            TextField("e.g. Maggie", text: $name)
                .font(.inter(16))
                .foregroundStyle(Color.text)
                .textContentType(.nickname)
                .textInputAutocapitalization(.words)
                .submitLabel(.done)
                .focused($focused)
                .onSubmit(save)
                .padding(.horizontal, 14)
                .frame(height: 48)
                .background(Color.surface, in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Color.line))
            if let errorMessage {
                Text(errorMessage)
                    .font(.inter(14, weight: .medium))
                    .foregroundStyle(Color.warn)
            }
            Button(action: save) {
                if isSaving { ProgressView().tint(.white) } else { Text("Save") }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(isSaving || name.trimmingCharacters(in: .whitespaces).isEmpty)
            .opacity(name.trimmingCharacters(in: .whitespaces).isEmpty ? 0.4 : 1)
            Button(auth.nickname == nil ? "Skip for now" : "Cancel") { dismiss() }
                .font(.inter(15, weight: .semibold))
                .foregroundStyle(Color.plum)
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .padding(24)
        .presentationDetents([.height(400)])
        .presentationBackground(Color.appBackground)
        .onAppear { focused = true }
        .onChange(of: auth.nickname, initial: true) { _, nickname in
            if name.isEmpty, let nickname { name = nickname }
        }
    }

    private func save() {
        guard !isSaving, !name.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        isSaving = true
        errorMessage = nil
        Task {
            do {
                try await auth.updateNickname(name)
                dismiss()
            } catch {
                errorMessage = "We couldn’t save that name. Try again in a moment."
                isSaving = false
            }
        }
    }
}

/// Signed-in account sheet: "Hi Rob!", change kitchen name, log out (HomeScreen.tsx).
struct AccountView: View {
    @Environment(AuthModel.self) private var auth
    @Environment(\.dismiss) private var dismiss
    @State private var editingName = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(auth.nickname.map { "Hi \($0)!" } ?? "Your account")
                .font(.poppins(22))
                .foregroundStyle(Color.plum)
            if let email = auth.email {
                Text(email)
                    .font(.inter(15))
                    .foregroundStyle(Color.muted)
            }
            Button(auth.nickname == nil ? "Set your kitchen name" : "Change kitchen name") { editingName = true }
                .font(.inter(15, weight: .semibold))
                .foregroundStyle(Color.plum)
                .padding(.top, 8)
            Button {
                Task {
                    await auth.signOut()
                    dismiss()
                }
            } label: {
                Label("Log out", systemImage: "rectangle.portrait.and.arrow.right")
                    .font(.inter(16, weight: .semibold))
                    .foregroundStyle(Color.plum)
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .background(Color.chip, in: RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(.plain)
            .padding(.top, 18)
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .presentationDetents([.height(250)])
        .presentationBackground(Color.appBackground)
        .sheet(isPresented: $editingName) { NicknamePrompt() }
    }
}

#Preview {
    LoginView()
        .environment(AuthModel())
}
