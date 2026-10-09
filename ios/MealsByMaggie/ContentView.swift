import SwiftUI

struct ContentView: View {
    @Environment(RecipeStore.self) private var store

    var body: some View {
        RecipeListView()
            .overlay(alignment: .top) { toast }
            .animation(.spring(duration: 0.35), value: store.toast)
            .sensoryFeedback(.success, trigger: store.toast) { _, message in message != nil }
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
}
