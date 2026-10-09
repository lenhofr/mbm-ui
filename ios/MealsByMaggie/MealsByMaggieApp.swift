import SwiftUI

@main struct MealsByMaggieApp: App {
    @State private var auth: AuthModel

    init() {
        AppFonts.register()
        AuthModel.configureAmplify()
        _auth = State(initialValue: AuthModel())
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(auth)
                .task { await auth.refresh() }
                .preferredColorScheme(.light)
                .tint(.plum)
        }
    }
}
