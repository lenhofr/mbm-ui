import SwiftUI

// Home screen, styled after HomeScreen.tsx / HomeScreen.css in mbm-ui.
struct RecipeListView: View {
    @State private var recipes: [Recipe] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var searchText = ""
    @State private var selectedTag = "all"

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 12, alignment: .top), count: 2)

    /// The 8 most common tags, like topTags() in src/lib/search.ts.
    private var topTags: [String] {
        var counts: [String: Int] = [:]
        for recipe in recipes {
            for tag in Set((recipe.tags ?? []).map { $0.lowercased() }) {
                counts[tag, default: 0] += 1
            }
        }
        let sorted = counts.sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }
        return sorted.prefix(8).map(\.key)
    }

    private var filteredRecipes: [Recipe] {
        let query = searchText.trimmingCharacters(in: .whitespaces)
        return recipes.filter { recipe in
            let tags = (recipe.tags ?? []).map { $0.lowercased() }
            guard selectedTag == "all" || tags.contains(selectedTag) else { return false }
            guard !query.isEmpty else { return true }
            return recipe.title.localizedCaseInsensitiveContains(query)
                || tags.contains { $0.localizedCaseInsensitiveContains(query) }
                || (recipe.ingredients ?? []).contains { $0.name.localizedCaseInsensitiveContains(query) }
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Meals by Maggie")
                        .font(.lobster(31))
                        .foregroundStyle(Color.plum)
                        .padding(.horizontal, 2)
                        .padding(.top, 4)
                        .padding(.bottom, 12)

                    SearchField(text: $searchText)

                    if !topTags.isEmpty {
                        tagFilter
                            .padding(.top, 12)
                    }

                    Text(isLoading || errorMessage != nil ? " " : "\(filteredRecipes.count) \(filteredRecipes.count == 1 ? "recipe" : "recipes")")
                        .font(.inter(13))
                        .foregroundStyle(Color.muted)
                        .frame(minHeight: 44)
                        .padding(.horizontal, 2)

                    content
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 32)
            }
            .scrollDismissesKeyboard(.immediately)
            .background(Color.appBackground)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Recipe.self) { recipe in
                RecipeDetailView(recipe: recipe)
            }
            .refreshable { await load() }
            .task { await load() }
        }
    }

    private var tagFilter: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(["all"] + topTags, id: \.self) { tag in
                    Button {
                        selectedTag = tag
                    } label: {
                        TagFilterChip(text: tag == "all" ? "All" : tag, selected: selectedTag == tag)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
        }
        .padding(.horizontal, -16)
    }

    @ViewBuilder
    private var content: some View {
        if isLoading && recipes.isEmpty {
            VStack(spacing: 12) {
                ProgressView()
                    .tint(.plum)
                    .controlSize(.large)
                Text("Preheating the oven…")
                    .font(.inter(15))
                    .foregroundStyle(Color.muted)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 80)
        } else if let errorMessage, recipes.isEmpty {
            EmptyMessage(text: errorMessage, buttonTitle: "Try again") {
                Task { await load() }
            }
        } else if filteredRecipes.isEmpty {
            EmptyMessage(text: "Nothing matches. Try another search or tag.")
        } else {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 18) {
                ForEach(filteredRecipes) { recipe in
                    NavigationLink(value: recipe) {
                        RecipeCard(recipe: recipe)
                    }
                    .buttonStyle(PressableStyle())
                }
            }
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            recipes = try await RecipeAPI.listRecipes()
                .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// White rounded search box (`.search` in HomeScreen.css).
private struct SearchField: View {
    @Binding var text: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 17, weight: .medium))
            TextField("Search title, tag or ingredient", text: $text)
                .font(.inter(16))
                .foregroundStyle(Color.text)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
            if !text.isEmpty {
                Button {
                    text = ""
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 22, height: 22)
                        .background(Color(hex: 0xD9C5CF), in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .foregroundStyle(Color.muted)
        .padding(.horizontal, 14)
        .frame(height: 48)
        .background(Color.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Color.line))
    }
}

/// Filter chip in the tag row; the selected one is solid plum (`.chips-row .chip.on`).
private struct TagFilterChip: View {
    let text: String
    let selected: Bool

    var body: some View {
        Text(text.capitalized)
            .font(.inter(14, weight: selected ? .semibold : .medium))
            .foregroundStyle(selected ? Color.white : Color.text)
            .padding(.horizontal, 14)
            .frame(height: 34)
            .background(selected ? Color.plum : Color.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(selected ? Color.clear : Color.line))
    }
}

/// Square photo card with title and meta line (`.rcard` in HomeScreen.css).
private struct RecipeCard: View {
    let recipe: Recipe

    private var meta: String {
        let count = recipe.ingredients?.count ?? 0
        let parts = [
            recipe.cookTime.flatMap { $0.isEmpty ? nil : $0 },
            count > 0 ? "\(count) \(count == 1 ? "ingredient" : "ingredients")" : nil,
        ]
        return parts.compactMap { $0 }.joined(separator: " · ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Color.clear
                .aspectRatio(1, contentMode: .fit)
                .overlay { RecipeImage(url: recipe.imageURL, title: recipe.title) }
                .clipShape(RoundedRectangle(cornerRadius: 18))

            Text(recipe.title)
                .font(.poppins(15.5))
                .foregroundStyle(Color.plum)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .padding(.top, 8)

            if !meta.isEmpty {
                Text(meta)
                    .font(.inter(13))
                    .foregroundStyle(Color.muted)
                    .lineLimit(1)
                    .padding(.top, 3)
            }
        }
        .contentShape(Rectangle())
    }
}

/// Shrinks slightly while pressed, like `.rcard.pressing`.
private struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

private struct EmptyMessage: View {
    let text: String
    var buttonTitle: String?
    var action: () -> Void = {}

    var body: some View {
        VStack(spacing: 16) {
            Text(text)
                .font(.inter(15))
                .foregroundStyle(Color.muted)
                .multilineTextAlignment(.center)
            if let buttonTitle {
                Button(buttonTitle, action: action)
                    .font(.inter(16, weight: .semibold))
                    .foregroundStyle(Color.plum)
                    .padding(.horizontal, 18)
                    .frame(height: 48)
                    .background(Color.chip, in: RoundedRectangle(cornerRadius: 14))
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
        .padding(.horizontal, 20)
    }
}

/// Recipe photo, or the striped placeholder with the title's first letter
/// (`.rimg.noimg` in ui.css) when there's no photo or it fails to load.
struct RecipeImage: View {
    let url: URL?
    let title: String
    var letterSize: CGFloat = 52

    var body: some View {
        AsyncImage(url: url) { phase in
            if let image = phase.image {
                image.resizable().scaledToFill()
            } else if url != nil, phase.error == nil {
                Color.chip
            } else {
                placeholder
            }
        }
    }

    private var placeholder: some View {
        ZStack {
            Canvas { context, size in
                context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Color(hex: 0xF8EAF1)))
                var stripes = Path()
                var x = -size.height
                while x < size.width {
                    stripes.move(to: CGPoint(x: x, y: size.height))
                    stripes.addLine(to: CGPoint(x: x + size.height, y: 0))
                    x += 20 * 2.squareRoot()
                }
                context.stroke(stripes, with: .color(Color(hex: 0xF3E1EA)), lineWidth: 10)
            }
            Text(String(title.prefix(1)))
                .font(.lobster(letterSize))
                .foregroundStyle(Color.plum.opacity(0.45))
        }
    }
}

#Preview {
    RecipeListView()
}
