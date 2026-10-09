import SwiftUI

@main struct MealsByMaggieApp: App {
    @State private var auth: AuthModel
    @State private var store = RecipeStore()

    init() {
        AppFonts.register()
        AuthModel.configureAmplify()
        _auth = State(initialValue: AuthModel())
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(auth)
                .environment(store)
                .task { await auth.refresh() }
                .preferredColorScheme(.light)
                .tint(.plum)
        }
    }
}
