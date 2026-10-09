import SwiftUI

@main struct MealsByMaggieApp: App {
    init() {
        AppFonts.register()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.light)
                .tint(.plum)
        }
    }
}
