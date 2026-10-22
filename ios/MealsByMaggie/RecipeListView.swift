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
    @State private var showFavorites = false
    @State private var showTips = false
    /// Long-pressed or "N ingredients"-tapped card (QuickView), and what to do once it closes.
    @State private var quickRecipe: Recipe?
    @State private var quickAction: (QuickView.Action, Recipe)?
    @State private var cookRecipe: Recipe?
    /// Picked once per launch (talk.loading in kitchenTalk.ts).
    @State private var loadingLine = ["Simmering…", "Preheating the oven…", "Raiding the pantry…",
                                      "Sharpening the knives…", "Letting the dough rise…", "Stirring the pot…"].randomElement()!
    @Environment(Favorites.self) private var favorites

    private var recipes: [Recipe] { store.recipes }
    private var isLoading: Bool { store.isLoading }
    private var errorMessage: String? { store.loadError }

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 12, alignment: .top), count: 2)

    /// The fixed filter chips that some recipe has (Tags.swift, chipTags in tags.ts).
    private var chipTags: [String] { Tags.chips(for: recipes) }

    /// Fuzzy search over title, tags, ingredients, steps and chef (RecipeSearch.swift).
    private var filteredRecipes: [Recipe] {
        let hits = RecipeSearch.matches(in: recipes, query: searchText)
        return recipes.filter { recipe in
            guard !showFavorites || favorites.contains(recipe.id) else { return false }
            guard selectedTag == "all" || recipe.allTags.contains(selectedTag) else { return false }
            return hits?.contains(recipe.id) ?? true
        }
    }

    /// Recipes tab only: up to 2 tips once the search is 3+ characters (HomeScreen.tsx).
    private var inlineTips: [QuickTip] {
        let query = searchText.trimmingCharacters(in: .whitespaces)
        guard !showFavorites, query.count >= 3 else { return [] }
        return Array(QuickTip.search(query).prefix(2))
    }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        if showFavorites {
                            Text("Favorites")
                                .font(.poppins(28))
                                .foregroundStyle(Color.plum)
                        } else {
                            Text("Meals by Maggie")
                                .font(.lobster(31))
                                .foregroundStyle(Color.plum)
                        }
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

                    if !chipTags.isEmpty {
                        tagFilter
                            .padding(.top, 12)
                    }

                    // Count row + tips show in every state, so Quick tips still work
                    // offline (bundled data) even when the recipes fail to load.
                    HStack {
                        Text(isLoading || errorMessage != nil ? " " : "\(filteredRecipes.count) \(filteredRecipes.count == 1 ? "recipe" : "recipes")")
                            .font(.inter(13))
                            .foregroundStyle(Color.muted)
                        Spacer()
                        if !showFavorites {
                            Button { showTips = true } label: {
                                Label("Quick tips", systemImage: "lightbulb")
                                    .font(.inter(13.5, weight: .semibold))
                                    .foregroundStyle(Color.plum)
                                    .frame(minHeight: 44)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .frame(minHeight: 44)
                    .padding(.horizontal, 2)
                    .padding(.vertical, 4)

                    InlineTips(tips: inlineTips)

                    content
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 32)
            }
            .scrollDismissesKeyboard(.immediately)
            .background(Color.appBackground)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: String.self) { id in
                RecipeDetailView(recipeID: id)
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                TabBar(showFavorites: $showFavorites) {
                    if auth.isSignedIn { showAddSheet = true } else { showLogin = true }
                }
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
            .sheet(isPresented: $showTips) { QuickTipsSheet() }
            .sheet(item: $quickRecipe, onDismiss: runQuickAction) { recipe in
                QuickView(recipe: recipe) { quickAction = ($0, recipe) }
            }
            .fullScreenCover(item: $cookRecipe) { CookView(recipe: $0) }
            .task { if store.recipes.isEmpty { await store.load() } }
            // A tapped mealsbymaggie.com/recipe/<id> link (DeepLink.swift), also on a cold launch.
            .onOpenURL { url in
                guard let id = DeepLink.recipeID(from: url) else { return }
                Task { await openLinkedRecipe(id) }
            }
        }
    }

    /// "Open recipe" / "Start cooking" from the quick view, once its sheet has closed.
    private func runQuickAction() {
        guard let pending = quickAction else { return }
        quickAction = nil
        switch pending.0 {
        case .open: path.append(pending.1.id)
        case .cook: cookRecipe = pending.1
        }
    }

    /// Shows a recipe from a shared link. Like DetailScreen.tsx, an unknown id doesn't
    /// open a page; the web sends you home, here a toast says so.
    private func openLinkedRecipe(_ id: String) async {
        showLogin = false
        showAccount = false
        showAddSheet = false
        showPaste = false
        // Not loaded yet (cold launch) or added since the list was fetched.
        if store.recipe(id: id) == nil { await store.load() }
        // Offline: the list already shows the load error with "Try again".
        guard store.loadError == nil else { return }
        guard store.recipe(id: id) != nil else {
            store.toast = "That recipe isn't in the box anymore"
            return
        }
        // Push rather than replace, so an open editor further back isn't thrown away.
        if path.last != id { path.append(id) }
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
                ForEach(["all"] + chipTags, id: \.self) { tag in
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
                CookSpinner(size: 40)
                Text(loadingLine)
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
            EmptyMessage(text: showFavorites && searchText.isEmpty && selectedTag == "all"
                ? "Your favorites shelf is empty. Tap ♥ on a recipe to keep it here."
                : "Nothing matches. Try another search or tag.")
        } else {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 18) {
                ForEach(filteredRecipes) { recipe in
                    VStack(alignment: .leading, spacing: 0) {
                        NavigationLink(value: recipe.id) {
                            RecipeCard(recipe: recipe)
                        }
                        .buttonStyle(PressableStyle())
                        .overlay(alignment: .topTrailing) {
                            HeartButton(isOn: favorites.contains(recipe.id)) { favorites.toggle(recipe.id) }
                                .padding(8)
                        }
                        // Long-press: the web opens the quick view; iOS shows its usual menu,
                        // led by the same pantry check.
                        .contextMenu { cardMenu(recipe) }
                        RecipeCardMeta(recipe: recipe) { quickRecipe = recipe }
                    }
                }
            }
        }
    }

}

extension RecipeListView {
    @ViewBuilder
    fileprivate func cardMenu(_ recipe: Recipe) -> some View {
        if !(recipe.ingredients ?? []).isEmpty {
            Button { quickRecipe = recipe } label: {
                Label("What do I have?", systemImage: "checklist")
            }
        }
        if !(recipe.instructions ?? []).isEmpty {
            Button { cookRecipe = recipe } label: {
                Label("Start cooking", systemImage: "play")
            }
        }
        Button { favorites.toggle(recipe.id) } label: {
            favorites.contains(recipe.id)
                ? Label("Remove from favorites", systemImage: "heart.slash")
                : Label("Add to favorites", systemImage: "heart")
        }
        if let link = recipe.webURL {
            ShareLink(item: link, subject: Text(recipe.title), message: Text(recipe.title),
                      preview: SharePreview(recipe.title)) {
                Label("Share", systemImage: "square.and.arrow.up")
            }
        }
    }
}

/// Recipes · + · Favorites bar along the bottom (TabBar.tsx / TabBar.css).
private struct TabBar: View {
    @Binding var showFavorites: Bool
    let onAdd: () -> Void

    var body: some View {
        HStack(alignment: .top) {
            tab("Recipes", icon: "book", selectedIcon: "book.fill", selected: !showFavorites) { showFavorites = false }
            Spacer()
            Button(action: onAdd) {
                Image(systemName: "plus")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 58, height: 58)
                    .background(Color.plum, in: Circle())
                    .shadow(color: Color.plum.opacity(0.35), radius: 9, y: 6)
            }
            .buttonStyle(PressableStyle())
            .offset(y: -20)
            .accessibilityLabel("Add a recipe")
            Spacer()
            tab("Favorites", icon: "heart", selectedIcon: "heart.fill", selected: showFavorites) { showFavorites = true }
        }
        .padding(.horizontal, 44)
        .padding(.top, 6)
        .frame(height: 52, alignment: .top)
        .background {
            Rectangle()
                .fill(.ultraThinMaterial)
                .overlay(Color.appBackground.opacity(0.6))
                .overlay(alignment: .top) { Color.line.frame(height: 1) }
                .ignoresSafeArea(edges: .bottom)
        }
        .sensoryFeedback(.selection, trigger: showFavorites)
    }

    private func tab(_ title: String, icon: String, selectedIcon: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Image(systemName: selected ? selectedIcon : icon)
                    .font(.system(size: 20))
                    .frame(height: 24)
                Text(title)
                    .font(.inter(11, weight: selected ? .semibold : .medium))
            }
            .foregroundStyle(selected ? Color.plum : Color.muted)
            .frame(width: 72, height: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// White circle heart on a recipe card (`.fav-dot`).
private struct HeartButton: View {
    let isOn: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: isOn ? "heart.fill" : "heart")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(isOn ? Color.pink : Color.plum)
                .frame(width: 34, height: 34)
                .background(.white.opacity(0.9), in: Circle())
                .contentShape(Circle().inset(by: -5))
                .symbolEffect(.bounce, value: isOn)
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.impact(weight: .light), trigger: isOn)
        .accessibilityLabel(isOn ? "Remove from favorites" : "Add to favorites")
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

/// White rounded search box (`.search` in HomeScreen.css); also the Quick tips filter.
struct SearchField: View {
    @Binding var text: String
    var prompt = "Search recipes, ingredients or chefs"
    var clearLabel = "Clear search"

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 17, weight: .medium))
            TextField(prompt, text: $text)
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
                .accessibilityLabel(clearLabel)
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

/// Square photo card with its title (`.rcard` in HomeScreen.css); the meta line sits
/// below it in RecipeCardMeta so its "N ingredients" link isn't part of the card's tap.
private struct RecipeCard: View {
    let recipe: Recipe

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
        }
        .contentShape(Rectangle())
    }
}

/// "25 min · 7 ingredients" under a card; the count opens the quick view (`.rmeta`, `.ing-link`).
private struct RecipeCardMeta: View {
    let recipe: Recipe
    let onQuickView: () -> Void

    private var cookTime: String? { recipe.cookTime.flatMap { $0.isEmpty ? nil : $0 } }
    private var count: Int { recipe.ingredients?.count ?? 0 }

    var body: some View {
        if cookTime != nil || count > 0 {
            HStack(spacing: 0) {
                if let cookTime {
                    Text(cookTime)
                        .foregroundStyle(Color.muted)
                        .layoutPriority(-1)
                }
                if cookTime != nil && count > 0 {
                    Text(" · ").foregroundStyle(Color.muted)
                }
                if count > 0 {
                    Button(action: onQuickView) {
                        Text("\(count) \(count == 1 ? "ingredient" : "ingredients")")
                            .font(.inter(13, weight: .semibold))
                            .foregroundStyle(Color.plum)
                            .underline(color: Color(hex: 0xE3C3D3))
                            .padding(.vertical, 4)  // bigger tap target that doesn't push the row
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .padding(.vertical, -4)
                    .fixedSize()
                }
            }
            .font(.inter(13))
            .lineLimit(1)
            .padding(.top, 3)
        }
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
        .environment(Favorites())
}
