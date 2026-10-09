import SwiftUI

// Recipe detail, styled after DetailScreen.tsx / DetailScreen.css in mbm-ui.
// Looks the recipe up in the shared store so edits show up immediately.
struct RecipeDetailView: View {
    let recipeID: String
    @Environment(RecipeStore.self) private var store
    @Environment(AuthModel.self) private var auth
    @Environment(\.dismiss) private var dismiss
    @State private var isEditing = false
    @State private var wasDeleted = false

    var body: some View {
        Group {
            if let recipe = store.recipe(id: recipeID) {
                RecipeDetailBody(recipe: recipe)
            } else {
                Color.appBackground.ignoresSafeArea()
            }
        }
        .toolbar {
            if auth.isSignedIn, store.recipe(id: recipeID) != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Edit recipe", systemImage: "pencil") { isEditing = true }
                }
            }
        }
        .fullScreenCover(isPresented: $isEditing, onDismiss: { if wasDeleted { dismiss() } }) {
            if let recipe = store.recipe(id: recipeID) {
                RecipeEditorView(draft: RecipeDraft(recipe: recipe), onDeleted: { wasDeleted = true })
            }
        }
    }
}

private struct RecipeDetailBody: View {
    let recipe: Recipe
    @State private var checked: Set<Int> = []
    @State private var isCooking = false

    private var hasSteps: Bool { !(recipe.instructions ?? []).isEmpty }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                RecipeImage(url: recipe.imageURL, title: recipe.title, letterSize: 110)
                    .frame(height: 330)
                    .frame(maxWidth: .infinity)
                    .clipped()

                VStack(alignment: .leading, spacing: 0) {
                    header
                    metaCells
                        .padding(.top, 18)
                    if let ingredients = recipe.ingredients, !ingredients.isEmpty {
                        sectionTitle("Ingredients")
                        IngredientChecklist(ingredients: ingredients, checked: $checked)
                    }
                    if let steps = recipe.instructions, !steps.isEmpty {
                        sectionTitle("Instructions")
                        stepList(steps)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 24)
                .padding(.bottom, hasSteps ? 100 : 40)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.appBackground, in: UnevenRoundedRectangle(topLeadingRadius: 28, topTrailingRadius: 28))
                .padding(.top, -28)
            }
        }
        .background(Color.appBackground)
        .ignoresSafeArea(edges: .top)
        .overlay(alignment: .bottom) {
            if hasSteps { startCookingBar }
        }
        .toolbarBackground(.hidden, for: .navigationBar)
        .fullScreenCover(isPresented: $isCooking) {
            CookView(recipe: recipe)
        }
    }

    /// Pinned "Start cooking" button over a fade (`.bottom-cta` in DetailScreen.css).
    private var startCookingBar: some View {
        Button {
            isCooking = true
        } label: {
            Label("Start cooking", systemImage: "play.fill")
        }
        .buttonStyle(PrimaryButtonStyle())
        .padding(.horizontal, 16)
        .padding(.top, 28)
        .padding(.bottom, 14)
        .background(
            LinearGradient(
                stops: [.init(color: Color.appBackground.opacity(0), location: 0), .init(color: Color.appBackground, location: 0.28)],
                startPoint: .top, endPoint: .bottom
            )
            .ignoresSafeArea(edges: .bottom)
        )
    }

    private var byline: String? {
        let name = recipe.createdByName.flatMap { $0.isEmpty || $0.lowercased() == "user" ? nil : $0 }
        var when: String?
        if let updated = recipe.updatedAt, updated != recipe.createdAt {
            when = "updated \(relativeTime(updated))"
        } else if let created = recipe.createdAt {
            when = "added \(relativeTime(created))"
        }
        let parts = [name.map { "By \($0)" }, when].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(recipe.title)
                .font(.poppins(27))
                .foregroundStyle(Color.plum)
            if let description = recipe.description, !description.isEmpty {
                Text(description)
                    .font(.inter(16))
                    .foregroundStyle(Color.text)
                    .lineSpacing(4)
                    .padding(.top, 8)
            }
            if let byline {
                Text(byline)
                    .font(.inter(13))
                    .foregroundStyle(Color.muted)
                    .padding(.top, 8)
            }
            if let tags = recipe.tags, !tags.isEmpty {
                FlowLayout(spacing: 8) {
                    ForEach(tags, id: \.self) { tag in
                        TagChip(text: tag.lowercased(), selected: true)
                    }
                }
                .padding(.top, 14)
            }
        }
    }

    private var metaCells: some View {
        HStack(spacing: 10) {
            MetaCell(icon: "clock", label: "Time", value: recipe.cookTime)
            MetaCell(icon: "person.2", label: "Servings", value: recipe.servings)
        }
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(title)
            .font(.poppins(19))
            .foregroundStyle(Color.text)
            .padding(.top, 28)
            .padding(.bottom, 8)
    }

    private func stepList(_ steps: [String]) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                HStack(alignment: .top, spacing: 12) {
                    Text("\(index + 1)")
                        .font(.inter(13, weight: .bold))
                        .foregroundStyle(Color.plum)
                        .frame(width: 28, height: 28)
                        .background(Color.chip, in: Circle())
                    Text(step)
                        .font(.inter(16))
                        .foregroundStyle(Color.text)
                        .lineSpacing(5)
                        .padding(.top, 3)
                }
            }
        }
    }

    private func relativeTime(_ timestamp: Double) -> String {
        let days = Int((Date().timeIntervalSince1970 - timestamp) / 86_400)
        switch days {
        case ...0: return "today"
        case 1: return "yesterday"
        default: return "\(days) days ago"
        }
    }
}

/// White info card for time / servings (`.meta-cell` in DetailScreen.css).
private struct MetaCell: View {
    let icon: String
    let label: String
    let value: String?

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 18))
                .foregroundStyle(Color.plum)
            VStack(alignment: .leading, spacing: 3) {
                Text(label)
                    .font(.inter(12))
                    .foregroundStyle(Color.muted)
                Text(value.flatMap { $0.isEmpty ? nil : $0 } ?? "—")
                    .font(.inter(16, weight: .semibold))
                    .foregroundStyle(Color.text)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity)
        .background(Color.surface, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.line))
    }
}

#Preview {
    NavigationStack {
        RecipeDetailBody(recipe: Recipe(
            id: "preview",
            title: "Crockpot Chicken Pasta",
            description: "Creamy, easy, and weeknight friendly.",
            tags: ["crockpot", "pasta"],
            ingredients: [.init(name: "pasta", amount: "1 box"), .init(name: "marinara", amount: "28 oz")],
            cookTime: "3 hours",
            instructions: ["Mix everything in the crockpot.", "Cook on high for 3 hours."],
            createdByName: "Rob",
            createdAt: Date().timeIntervalSince1970 - 86_400 * 3
        ))
    }
}
