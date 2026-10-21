import Foundation

// Universal Links: a tapped https://mealsbymaggie.com/recipe/<id> link opens the app
// instead of Safari. iOS checks the site's /.well-known/apple-app-site-association
// (public/.well-known/ in the web app) against the Associated Domains entitlement
// (MealsByMaggie.entitlements), then hands the URL to .onOpenURL in RecipeListView.
enum DeepLink {
    /// The recipe id in a website link. Matches the /recipe/:id, /recipe/:id/cook and
    /// /recipe/:id/edit routes in App.tsx; all three open the recipe page here.
    static func recipeID(from url: URL) -> String? {
        guard url.scheme == "https", url.host()?.lowercased() == "mealsbymaggie.com" else { return nil }
        let parts = url.pathComponents  // ["/", "recipe", "<id>", ...], percent-decoded
        guard parts.count >= 3, parts[1] == "recipe", !parts[2].isEmpty else { return nil }
        return parts[2]
    }
}
