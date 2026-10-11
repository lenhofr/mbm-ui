import SwiftUI

struct ContentView: View {
    @Environment(RecipeStore.self) private var store
    @Environment(AuthModel.self) private var auth
    @Environment(Favorites.self) private var favorites
    @State private var askForNickname = false
    /// Asked at most once per launch, like the web's dismissible prompt.
    @State private var askedForNickname = false

    var body: some View {
        RecipeListView()
            .overlay(alignment: .top) { toast }
            .animation(.spring(duration: 0.35), value: store.toast)
            .sensoryFeedback(.success, trigger: store.toast) { _, message in message != nil }
            // Each account keeps its own favorites, like the web.
            .onChange(of: auth.userSub, initial: true) { _, sub in favorites.load(for: sub) }
            // Opened the app already signed in, without a kitchen nickname: ask once
            // (CompleteProfile in App.tsx). Sign-ins from the login sheet ask there.
            .onChange(of: auth.state) { oldState, state in
                if oldState == .loading, state == .signedIn, auth.nickname?.isEmpty ?? true, !askedForNickname {
                    askedForNickname = true
                    askForNickname = true
                }
            }
            .sheet(isPresented: $askForNickname) { NicknamePrompt() }
    }

    /// Confirmation pill after saving or deleting (toast in AppContext.tsx).
    @ViewBuilder
    private var toast: some View {
        if let message = store.toast {
            Text(message)
                .font(.inter(15, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 18)
                .padding(.vertical, 12)
                .background(Color.text, in: Capsule())
                .shadow(color: .black.opacity(0.15), radius: 10, y: 4)
                .padding(.top, 8)
                .transition(.move(edge: .top).combined(with: .opacity))
                .task(id: message) {
                    try? await Task.sleep(for: .seconds(2.6))
                    store.toast = nil
                }
        }
    }
}

#Preview {
    ContentView()
        .environment(AuthModel())
        .environment(RecipeStore())
        .environment(Favorites())
}
