import SwiftUI

// Home screen, styled after HomeScreen.tsx / HomeScreen.css in mbm-ui.
struct RecipeListView: View {
    @Environment(AuthModel.self) private var auth
    @Environment(RecipeStore.self) private var store
    @State private var path: [String] = []
    @State private var showLogin = false
    @State private var showAccount = false
    @State private var showNewRecipe = false
    @State private var showAddSheet = false
    @State private var showPaste = false
    @State private var showScanner = false
    @State private var importJob: ImportJob?
    /// A scan or paste waiting for its sheet to finish closing before the import starts.
    @State private var queuedJob: ImportJob?
    /// What to open once the add sheet has finished closing.
    @State private var pendingChoice: AddRecipeSheet.Choice?
    @State private var searchText = ""
    @State private var selectedTag = "all"

    private var recipes: [Recipe] { store.recipes }
    private var isLoading: Bool { store.isLoading }
    private var errorMessage: String? { store.loadError }

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 12, alignment: .top), count: 2)

    /// The 8 most common tags for the filter row.
    private var topTags: [String] { store.topTags(limit: 8) }

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
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        Text("Meals by Maggie")
                            .font(.lobster(31))
                            .foregroundStyle(Color.plum)
                        Spacer()
                        AvatarButton(initial: auth.isSignedIn ? auth.displayName?.first.map { String($0).uppercased() } : nil) {
                            if auth.isSignedIn { showAccount = true } else { showLogin = true }
                        }
                        .opacity(auth.state == .loading ? 0 : 1)
                    }
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
                .padding(.bottom, 110)
            }
            .scrollDismissesKeyboard(.immediately)
            .background(Color.appBackground)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: String.self) { id in
                RecipeDetailView(recipeID: id)
            }
            .overlay(alignment: .bottom) {
                AddButton {
                    if auth.isSignedIn { showAddSheet = true } else { showLogin = true }
                }
                .padding(.bottom, 8)
            }
            .refreshable { await store.load() }
            .sheet(isPresented: $showLogin) { LoginView() }
            .sheet(isPresented: $showAccount) { AccountView() }
            .sheet(isPresented: $showAddSheet, onDismiss: openPendingChoice) {
                AddRecipeSheet { choice in
                    pendingChoice = choice
                    showAddSheet = false
                }
            }
            .sheet(isPresented: $showPaste, onDismiss: startQueuedImport) {
                PasteSheet { job in
                    queuedJob = job
                    showPaste = false
                }
            }
            .fullScreenCover(isPresented: $showScanner, onDismiss: startQueuedImport) {
                DocumentScanner { pages in queuedJob = ImportJob(kind: .scan(pages)) }
                    .ignoresSafeArea()
            }
            .fullScreenCover(item: $importJob) { job in
                ImportFlowView(job: job) { saved in path.append(saved.id) }
            }
            .fullScreenCover(isPresented: $showNewRecipe) {
                // Open the new recipe once it's saved.
                RecipeEditorView(draft: RecipeDraft()) { saved in path.append(saved.id) }
            }
            .task { if store.recipes.isEmpty { await store.load() } }
        }
    }

    /// Opens the scanner, paste sheet or blank editor after the add sheet closes
    /// (iOS can only present one sheet at a time).
    private func openPendingChoice() {
        guard let choice = pendingChoice else { return }
        pendingChoice = nil
        switch choice {
        case .scan: showScanner = true
        case .paste: showPaste = true
        case .manual: showNewRecipe = true
        }
    }

    /// Opening the import screen while the scanner is still closing makes SwiftUI
    /// start it twice, so wait for the dismissal to finish.
    private func startQueuedImport() {
        guard let job = queuedJob else { return }
        queuedJob = nil
        importJob = job
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
                Task { await store.load() }
            }
        } else if filteredRecipes.isEmpty {
            EmptyMessage(text: "Nothing matches. Try another search or tag.")
        } else {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 18) {
                ForEach(filteredRecipes) { recipe in
                    NavigationLink(value: recipe.id) {
                        RecipeCard(recipe: recipe)
                    }
                    .buttonStyle(PressableStyle())
                }
            }
        }
    }

}

/// Big plum "+" button floating at the bottom (`.tab-add` in TabBar.css).
private struct AddButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "plus")
                .font(.system(size: 24, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 60, height: 60)
                .background(Color.plum, in: Circle())
                .shadow(color: Color.plum.opacity(0.35), radius: 10, y: 4)
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel("Add a recipe")
    }
}

/// Round chip-colored button: the user's initial when signed in, a sign-in icon otherwise (`.avatar`).
private struct AvatarButton: View {
    let initial: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Group {
                if let initial {
                    Text(initial).font(.poppins(16))
                } else {
                    Image(systemName: "person.crop.circle.badge.plus")
                        .font(.system(size: 18, weight: .medium))
                }
            }
            .foregroundStyle(Color.plum)
            .frame(width: 38, height: 38)
            .background(Color.chip, in: Circle())
            .frame(width: 44, height: 44)
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(initial == nil ? "Log in" : "Account")
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
struct PressableStyle: ButtonStyle {
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
        .environment(AuthModel())
        .environment(RecipeStore())
}
