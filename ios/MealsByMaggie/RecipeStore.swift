import Foundation

// The recipe list shared by every screen (recipes/saveDraft/deleteRecipe in
// src/state/AppContext.tsx), so an edit shows up everywhere at once.
@Observable
final class RecipeStore {
    private(set) var recipes: [Recipe] = []
    private(set) var isLoading = false
    private(set) var loadError: String?
    /// Short confirmation shown at the bottom of the screen ("Fresh out of the oven!").
    var toast: String?

    func recipe(id: String) -> Recipe? {
        recipes.first { $0.id == id }
    }

    /// Most-used tags, most common first (topTags in src/lib/search.ts).
    func topTags(limit: Int) -> [String] {
        var counts: [String: Int] = [:]
        for recipe in recipes {
            for tag in Set((recipe.tags ?? []).map { $0.lowercased() }) {
                counts[tag, default: 0] += 1
            }
        }
        let sorted = counts.sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }
        return sorted.prefix(limit).map(\.key)
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            recipes = try await RecipeAPI.listRecipes().sorted(by: Self.byTitle)
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
    }

    /// Uploads a new photo if there is one, then creates or updates the recipe.
    func save(_ draft: RecipeDraft, auth: AuthModel) async throws -> Recipe {
        guard let token = await auth.idToken() else { throw RecipeAPI.APIError.notSignedIn }
        var image = draft.image
        if let photo = draft.newPhoto, let jpeg = photo.uploadJPEG() {
            image = try await RecipeAPI.uploadImage(jpeg, token: token)
        }
        let input = draft.input(image: image)
        if let id = draft.id {
            let updated = try await RecipeAPI.updateRecipe(id: id, input, token: token)
            if let index = recipes.firstIndex(where: { $0.id == id }) { recipes[index] = updated }
            show(["Seasoned to perfection", "Tweaks saved", "Back in the box"])
            return updated
        }
        let created = try await RecipeAPI.createRecipe(input, token: token)
        recipes.append(created)
        recipes.sort(by: Self.byTitle)
        show(["Fresh out of the oven!", "Into the recipe box it goes", "Plated and saved"])
        return created
    }

    func delete(id: String, auth: AuthModel) async throws {
        guard let token = await auth.idToken() else { throw RecipeAPI.APIError.notSignedIn }
        try await RecipeAPI.deleteRecipe(id: id, token: token)
        recipes.removeAll { $0.id == id }
        show(["86’d!", "Off the menu", "Scraped into the bin"])
    }

    private func show(_ lines: [String]) {
        toast = lines.randomElement()
    }

    private static func byTitle(_ a: Recipe, _ b: Recipe) -> Bool {
        a.title.localizedCaseInsensitiveCompare(b.title) == .orderedAscending
    }
}
