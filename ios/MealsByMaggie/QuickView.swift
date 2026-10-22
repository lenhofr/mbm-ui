import SwiftUI

/// Pantry check: tick the ingredients you already have, without opening the recipe
/// (QuickView.tsx / QuickView.css in mbm-ui). Opened by long-pressing a recipe card
/// (its menu) or tapping "N ingredients" under it.
struct QuickView: View {
    enum Action { case open, cook }

    let recipe: Recipe
    /// The list remembers the choice and acts once the sheet has closed (runQuickAction).
    let onAction: (Action) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var have: Set<Int> = []

    private var ingredients: [Recipe.Ingredient] { recipe.ingredients ?? [] }
    private var missing: Int { ingredients.count - have.count }

    private var meta: String {
        [recipe.cookTime.flatMap { $0.isEmpty ? nil : $0 },
         recipe.servings.flatMap { $0.isEmpty ? nil : "serves \($0)" }]
            .compactMap { $0 }.joined(separator: " · ")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 14) {
                    RecipeImage(url: recipe.imageURL, title: recipe.title, letterSize: 30)
                        .frame(width: 64, height: 64)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                    VStack(alignment: .leading, spacing: 4) {
                        Text(recipe.title)
                            .font(.poppins(20))
                            .foregroundStyle(Color.plum)
                        if !meta.isEmpty {
                            Text(meta)
                                .font(.inter(13))
                                .foregroundStyle(Color.muted)
                        }
                    }
                }

                summary
                    .padding(.top, 16)
                    .padding(.bottom, 4)

                IngredientChecklist(ingredients: ingredients, checked: $have, variant: .have)

            }
            .padding(.horizontal, 20)
            .padding(.top, 24)
            .padding(.bottom, 20)
        }
        // Pinned, so they're reachable at half height without scrolling past the list.
        .safeAreaInset(edge: .bottom, spacing: 0) {
            HStack(spacing: 10) {
                Button("Open recipe") { finish(.open) }
                    .font(.inter(17, weight: .semibold))
                    .foregroundStyle(Color.plum)
                    .frame(maxWidth: .infinity, minHeight: 56)
                    .background(Color.chip, in: RoundedRectangle(cornerRadius: 16))
                if !(recipe.instructions ?? []).isEmpty {
                    Button { finish(.cook) } label: {
                        Label("Start cooking", systemImage: "play.fill")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 8)
            .background(Color.appBackground)
        }
        .presentationDetents([.medium, .large])
        .presentationBackground(Color.appBackground)
        .presentationDragIndicator(.visible)
    }

    /// "Tap what you already have" → "Missing 2 of 7" → "Pantry's stocked!" (`.qv-summary`).
    @ViewBuilder private var summary: some View {
        let allThere = !ingredients.isEmpty && missing == 0
        HStack(spacing: 6) {
            if have.isEmpty {
                Text("Tap what you already have")
            } else if allThere {
                Image(systemName: "checkmark").fontWeight(.bold)
                Text("Pantry’s stocked! You have everything").fontWeight(.semibold)
            } else {
                Text("Missing \(missing)").fontWeight(.bold) + Text(" of \(ingredients.count)")
            }
        }
        .font(.inter(14.5))
        .foregroundStyle(allThere ? Color.ok : Color.plum)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(allThere ? Color.okBackground : Color.chip, in: RoundedRectangle(cornerRadius: 12))
        .animation(.easeOut(duration: 0.15), value: have)
    }

    private func finish(_ action: Action) {
        onAction(action)
        dismiss()
    }
}
