import Foundation
import Testing
@testable import MealsByMaggie

// Expected values come from running the web app's own functions (src/lib/quantity.ts),
// so these tests fail if the Swift ports drift from what the website saves and shows.

struct IngredientParsingTests {
    @Test(arguments: [
        ("2 1/4 cups all-purpose flour", "2 1/4 cups", "all-purpose flour"),
        ("3 large eggs", "3", "large eggs"),
        ("1/2 cup Hidden Valley Ranch", "1/2 cup", "Hidden Valley Ranch"),
        ("1 pkg. (8 oz.) Cream Cheese, softened", "1 pkg.", "(8 oz.) Cream Cheese, softened"),
        ("1½ tsp vanilla", "1½ tsp", "vanilla"),
        ("4-6 chicken thighs", "4-6", "chicken thighs"),
        ("2 to 3 cloves garlic, minced", "2 to 3 cloves", "garlic, minced"),
        ("½ lb ground beef", "½ lb", "ground beef"),
        ("1 (28 oz) can crushed tomatoes", "1", "(28 oz) can crushed tomatoes"),
        ("12 oz pasta", "12 oz", "pasta"),
    ])
    func splitsAmountFromName(line: String, amount: String, name: String) {
        let ingredient = RecipeDraft.parseIngredientLine(line)
        #expect(ingredient.amount == amount)
        #expect(ingredient.name == name)
    }

    @Test(arguments: ["salt to taste", "0 sugar"])
    func linesWithoutAQuantityHaveNoAmount(line: String) {
        let ingredient = RecipeDraft.parseIngredientLine(line)
        #expect(ingredient.amount == nil)
        #expect(ingredient.name == line)
    }
}

struct QuantityScalingTests {
    @Test(arguments: [
        ("1 1/2 cups", 2.0, "3 cups"),
        ("1 1/2 cups", 0.5, "¾ cups"),
        ("2 1/4 cups", 0.5, "1⅛ cups"),
        ("2 1/4 cups", 1.5, "3⅓ cups"),
        ("2 1/4 cups", 0.75, "1⅔ cups"),
        ("1/3 cup", 0.5, "⅛ cup"),
        ("1/3 cup", 3.0, "1 cup"),
        ("½ lb", 0.75, "⅓ lb"),
        ("4-6", 1.5, "6"),
        ("2 to 3 cloves", 0.75, "1½ cloves"),
        ("0.5 cup", 3.0, "1½ cup"),
        ("1 (28 oz) can", 0.5, "½ (28 oz) can"),
        ("pinch", 2.0, "pinch"),
        ("½ lb", 2.0, "1 lb"),
        ("1½ tsp", 2.0, "3 tsp"),
    ])
    func scalesLikeTheWeb(amount: String, multiplier: Double, expected: String) {
        #expect(Quantity.scale(amount, by: multiplier) == expected)
    }

    @Test func unscaledAmountsAreUnchanged() {
        #expect(Quantity.scale("1 1/2 cups", by: 1) == "1 1/2 cups")
        #expect(Quantity.scale(nil, by: 2) == "")
    }
}

@MainActor
struct DraftTests {
    @Test func savedRecipeLeavesOutEmptyFields() {
        var draft = RecipeDraft()
        draft.title = "  Toast  "
        draft.tags = ["Breakfast", "breakfast ", ""]
        draft.ingredients = [.init(text: "2 slices bread"), .init(text: "  ")]
        draft.steps = [.init(text: "Toast it.")]
        let input = draft.input(image: nil)
        #expect(input.title == "Toast")
        #expect(input.description == nil)
        #expect(input.cookTime == nil)
        #expect(input.image == nil)
        #expect(input.tags == ["breakfast"])
        #expect(input.ingredients?.count == 1)
        #expect(input.ingredients?.first?.amount == "2 slices")
        #expect(input.instructions == ["Toast it."])
        #expect(input.servings == "4")
    }

    @Test func editingARecipeRoundTrips() {
        let recipe = Recipe(
            id: "r1", title: "Soup", description: "Hearty", image: "uploads/a.jpeg", tags: ["dinner"],
            ingredients: [.init(name: "carrots", amount: "2 cups")], servings: "6", cookTime: "1 hr",
            instructions: ["Simmer."]
        )
        let input = RecipeDraft(recipe: recipe).input(image: recipe.image)
        #expect(input.title == "Soup")
        #expect(input.description == "Hearty")
        #expect(input.servings == "6")
        #expect(input.ingredients?.first?.amount == "2 cups")
        #expect(input.ingredients?.first?.name == "carrots")
        #expect(input.instructions == ["Simmer."])
    }

    @Test func aiResultKeepsFlagsAndSuggestedTags() throws {
        let json = #"{"readable":true,"title":"Cake","servings":12,"tags":["Cake","dessert","cake"],"ingredients":[{"text":"1 tsp salt","flag":{"q":"Salt or soda?","opts":[["1 tsp salt","salt"],["1 tsp soda","soda"]]}},{"text":"2 eggs"}],"instructions":[{"text":"Bake."}]}"#
        let result = try JSONDecoder().decode(ExtractResult.self, from: Data(json.utf8))
        let draft = RecipeDraft(extract: result, job: ImportJob(kind: .text("…")))
        #expect(draft.source == .text)
        #expect(draft.servings == 12)
        #expect(draft.tags == ["cake", "dessert"])
        #expect(draft.aiTags == ["cake", "dessert"])
        #expect(draft.openFlagCount == 1)
        #expect(draft.initialFlagCount == 1)
        #expect(draft.ingredients[0].flag?.options.map(\.label) == ["salt", "soda"])
    }
}

struct ImportDetectionTests {
    @Test func detectsLinks() {
        guard case .link(let url) = ImportJob.detect("  https://www.example.com/cookies  ") else {
            Issue.record("expected a link")
            return
        }
        #expect(url == "https://www.example.com/cookies")
        #expect(ImportJob.host(of: url) == "example.com")
    }

    @Test func treatsEverythingElseAsText() {
        guard case .text = ImportJob.detect("2 cups flour\nMix well. See https://example.com") else {
            Issue.record("expected text")
            return
        }
        #expect(ImportJob.detect("   ") == nil)
    }

    @Test func readsSchemaOrgRecipeFromAPage() throws {
        let html = """
        <html><head><script type="application/ld+json">
        {"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":["Recipe"],"name":"Banana Bread",
         "recipeIngredient":["2 cups flour","3 bananas"],
         "recipeInstructions":[{"@type":"HowToStep","text":"Mash &amp; mix."},{"@type":"HowToStep","text":"Bake."}]}]}
        </script></head><body>Life story…</body></html>
        """
        let text = try #require(PageReader.structuredRecipe(in: html))
        #expect(text.hasPrefix("Banana Bread"))
        #expect(text.contains("- 3 bananas"))
        #expect(text.contains("1. Mash & mix."))
        #expect(text.contains("2. Bake."))
    }

    @Test func fallsBackToVisibleText() {
        let text = PageReader.visibleText(of: "<p>Hello <b>world</b></p><script>var x = 1</script><p>Bye</p>")
        #expect(text == "Hello world\nBye")
    }
}

struct TokenGroupsTests {
    /// A JWT with `payload` (header and signature are never checked).
    private func token(_ payload: String) -> String {
        let body = Data(payload.utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return "eyJhbGciOiJSUzI1NiJ9.\(body).sig"
    }

    @Test func readsCognitoGroups() {
        #expect(AuthModel.groups(inToken: token(#"{"sub":"a","cognito:groups":["admins"]}"#)) == ["admins"])
    }

    @Test func noGroupsClaim() {
        #expect(AuthModel.groups(inToken: token(#"{"sub":"a","nickname":"Rob?"}"#)).isEmpty)
        #expect(AuthModel.groups(inToken: "not-a-jwt").isEmpty)
    }
}

// Universal Links (DeepLink.swift): the same /recipe/:id routes as App.tsx.
struct DeepLinkTests {
    @Test(arguments: [
        ("https://mealsbymaggie.com/recipe/7f62e8e7-f297-4d22-90fc-8c01ab491c7d", "7f62e8e7-f297-4d22-90fc-8c01ab491c7d"),
        ("https://mealsbymaggie.com/recipe/abc/cook", "abc"),
        ("https://mealsbymaggie.com/recipe/abc/edit?x=1", "abc"),
        ("https://MealsByMaggie.com/recipe/abc", "abc"),
        ("https://mealsbymaggie.com/recipe/a%20b", "a b"),
    ])
    func findsRecipeID(link: String, id: String) {
        #expect(DeepLink.recipeID(from: URL(string: link)!) == id)
    }

    @Test(arguments: [
        "https://mealsbymaggie.com/",
        "https://mealsbymaggie.com/recipe/",
        "https://mealsbymaggie.com/new",
        "https://example.com/recipe/abc",
        "http://mealsbymaggie.com/recipe/abc",
    ])
    func ignoresOtherLinks(link: String) {
        #expect(DeepLink.recipeID(from: URL(string: link)!) == nil)
    }
}

// Search (RecipeSearch.swift ↔ src/lib/search.ts). The recipes come from
// src/lib/search.fixture.ts; the expected ids are what the web's Fuse.js search returned
// for each query, including typo'd words near the edge of what fuzzy matching allows.
struct RecipeSearchTests {
    static let recipes: [Recipe] = [
        Recipe(id: "alfredo",
               title: "Chicken Alfredo",
               description: "Creamy weeknight pasta.",
               tags: ["Pasta", "dinner"],
               ingredients: [.init(name: "fettuccine", amount: "1 lb"), .init(name: "chicken breasts", amount: "2"), .init(name: "parmesan cheese")],
               instructions: ["Boil the pasta.", "Simmer the sauce until thick."],
               createdByName: "Chef Mike Drop"),
        Recipe(id: "cookies",
               title: "Chocolate Chip Cookies",
               tags: ["dessert", "baking"],
               ingredients: [.init(name: "eggs", amount: "2"), .init(name: "chocolate chips", amount: "1 cup")],
               instructions: ["Cream the butter and sugar.", "Bake at 350°F for 10 minutes."],
               createdByName: "Nana"),
        Recipe(id: "chili",
               title: "Crockpot Chili",
               description: "Set it and forget it.",
               tags: ["Dinner", "slow cooker"],
               ingredients: [.init(name: "ground beef", amount: "1 lb"), .init(name: "kidney beans", amount: "1 can")],
               instructions: ["Brown the beef.", "Cook on low for 8 hours."],
               createdByName: "Chef Mike Drop"),
        Recipe(id: "pie",
               title: "Apple Pie",
               tags: ["dessert", "Easy"],
               ingredients: [.init(name: "apples", amount: "6"), .init(name: "pie crust")],
               instructions: ["Slice the apples."],
               createdByName: "Gram"),
        Recipe(id: "salad",
               title: "Greek Salad",
               tags: ["side", "vegan"],
               ingredients: [.init(name: "feta"), .init(name: "cucumber")],
               createdByName: "user"),
    ]

    @Test(arguments: [
        ("chicken", ["alfredo"]),
        ("chiken", ["alfredo"]),
        ("parmesn", ["alfredo"]),
        ("mike", ["alfredo", "chili"]),
        ("chef mike", ["alfredo", "chili"]),
        ("\"mike drop\"", ["alfredo", "chili"]),
        ("nana", ["cookies"]),
        ("gram", ["pie"]),
        ("user", []),
        ("chef:mike", ["alfredo", "chili"]),
        ("by:gram", ["pie"]),
        ("chef:user", []),
        ("mike dinner", ["alfredo", "chili"]),
        ("mike dessert", []),
        ("tag:dessert", ["cookies", "pie"]),
        ("ing:egg", ["cookies"]),
        ("dessert apple", ["pie"]),
        ("beans", ["chili"]),
        ("350", ["cookies"]),
        ("xyzzy", []),
        ("tag:crockpot", ["chili"]),
        ("tag:slow", ["chili"]),
        ("tag:vegetarian", ["salad"]),
        ("tag:vegan", ["salad"]),
        ("vegetarian", ["salad"]),
        ("tag:\"quick & easy\"", ["pie"]),
        ("tag:easy", ["pie"]),
        ("fettucine", ["alfredo"]),
        ("fettuxcine", ["alfredo"]),
        ("fettuccine", ["alfredo"]),
        ("fettuzzccine", ["alfredo"]),
        ("ettuccin", ["alfredo"]),
        ("parmsan", ["alfredo"]),
        ("parmxsan", ["alfredo"]),
        ("parmsean", []),
        ("parmzzesan", ["alfredo"]),
        ("armesa", ["alfredo"]),
        ("choclate", ["cookies"]),
        ("chocxlate", ["cookies"]),
        ("chocloate", []),
        ("choczzolate", ["cookies"]),
        ("hocolat", ["cookies"]),
        ("crocpot", ["chili"]),
        ("crocxpot", ["chili"]),
        ("crocpkot", []),
        ("croczzkpot", ["chili"]),
        ("rockpo", ["chili"]),
        ("kidey", ["chili"]),
        ("kidxey", ["chili"]),
        ("kideny", []),
        ("kidzzney", []),
        ("idne", ["chili"]),
        ("cucuber", ["salad"]),
        ("cucuxber", ["salad"]),
        ("cucubmer", []),
        ("cucuzzmber", ["salad"]),
        ("ucumbe", ["salad"]),
        ("weekight", ["alfredo"]),
        ("weekxight", ["alfredo"]),
        ("weekinght", []),
        ("weekzznight", ["alfredo"]),
        ("eeknigh", ["alfredo"]),
        ("simer", ["alfredo"]),
        ("simxer", ["alfredo"]),
        ("simemr", []),
        ("simzzmer", []),
        ("imme", ["alfredo"]),
        ("alfedo", ["alfredo"]),
        ("alfxedo", ["alfredo"]),
        ("alferdo", []),
        ("alfzzredo", []),
        ("lfred", ["alfredo"]),
        ("cooies", ["cookies"]),
        ("cooxies", ["cookies"]),
        ("cooikes", []),
        ("coozzkies", []),
        ("ookie", ["chili", "cookies"]),
        ("chli", []),
        ("chxli", ["chili"]),
        ("chlii", []),
        ("chzzili", []),
        ("hil", ["chili"]),
        ("appes", ["pie"]),
        ("appxes", ["pie"]),
        ("appels", []),
        ("appzzles", []),
        ("pple", ["pie"]),
        ("drp", []),
        ("drxp", []),
        ("drpo", []),
        ("drzzop", []),
        ("ro", ["alfredo", "chili"]),
        ("buter", ["cookies"]),
        ("butxer", ["cookies"]),
        ("butetr", []),
        ("butzzter", []),
        ("utte", ["cookies"]),
        ("mintes", ["cookies"]),
        ("minxtes", ["cookies"]),
        ("mintues", []),
        ("minzzutes", []),
        ("inute", ["cookies"]),
    ])
    func matchesTheWebSearch(query: String, ids: [String]) {
        let hits = RecipeSearch.matches(in: Self.recipes, query: query) ?? []
        #expect(hits.sorted() == ids)
    }

    @Test func emptyQueryShowsEverything() {
        #expect(RecipeSearch.matches(in: Self.recipes, query: "   ") == nil)
    }

    @Test func chefSkipsTheOldPlaceholderName() {
        #expect(Self.recipes.first { $0.id == "salad" }?.chefName == "")
        #expect(Self.recipes.first { $0.id == "pie" }?.chefName == "Gram")
    }
}

// Tag aliases and filter chips (Tags.swift ↔ src/lib/tags.ts), expected values from the web.
struct TagsTests {
    @Test(arguments: [
        (["Slow Cooker", "Dinner", "crockpot", " vegan "], ["slow cooker", "crockpot", "dinner", "vegan", "vegetarian"]),
        (["Easy", "quick"], ["easy", "quick & easy", "quick"]),
        (["keto", "Low-Carb"], ["keto", "low carb", "low-carb"]),
        (["finger food", "Appetizers"], ["finger food", "appetizer", "appetizers"]),
        (["desserts"], ["desserts", "dessert"]),
        (["Weeknight Dinner", "chicken"], ["weeknight dinner", "dinner", "chicken"]),
        ([], []),
    ] as [([String], [String])])
    func addsAliasMainTags(tags: [String], expected: [String]) {
        let recipe = Recipe(id: "x", title: "x", tags: tags)
        #expect(recipe.allTags == expected)
    }

    @Test func chipsMatchTheWeb() {
        #expect(Tags.chips(for: RecipeSearchTests.recipes) == ["dinner", "crockpot", "quick & easy", "pasta", "vegetarian", "dessert"])
        #expect(Tags.chips(for: []).isEmpty)
    }

    // Same case as the importerTags test in src/lib/tags.test.ts.
    @Test func importerGetsChipsThenOtherTagsWithoutAliases() {
        let tags = Tags.forImporter([
            Recipe(id: "a", title: "a", tags: ["Slow Cooker", "soup", "Dinner"]),
            Recipe(id: "b", title: "b", tags: ["soup", "beef", "easy"]),
            Recipe(id: "c", title: "c", tags: ["beef", "Soup "]),
        ])
        #expect(tags.main == Tags.chips)
        #expect(tags.known == ["soup", "beef"])
        let many = Tags.forImporter([Recipe(id: "x", title: "x", tags: (0..<40).map { "tag \($0)" })])
        #expect(many.main.count + many.known.count == 30)
    }
}

// Quick tips search (QuickTip.search ↔ searchTips in src/lib/quickTips.ts).
struct QuickTipsTests {
    @Test(arguments: [
        ("egg", ["eggs"]),
        ("boiled eggs", ["eggs", "poach-chicken"]),
        ("chicken", ["poach-chicken", "safe-temps"]),
        ("carrots", ["roast-veg", "boiled-carrots"]),
        ("steak", ["steak"]),
        ("temp", ["steak", "safe-temps"]),
        ("potato", ["roast-veg", "baked-potato"]),
        ("oz", ["conversions"]),
        ("convert", ["conversions"]),
        ("corn", ["corn"]),
        ("zzz", []),
        ("bacon", ["bacon"]),
        ("fish", ["fish", "safe-temps"]),
        ("salmon", ["fish"]),
        ("roast", ["roast-veg"]),
        ("medium rare", ["steak"]),
        ("eggs and bacon", ["eggs", "bacon"]),
    ])
    func matchesTheWebTips(query: String, ids: [String]) {
        #expect(QuickTip.search(query).map(\.id) == ids)
    }
}

// Tag rows on the recipe page (FlowLayout in Theme.swift). The chip widths are the
// ones in the bug report: Chicken, Baked, Easy, Dinner, Quick on a 390pt-wide phone
// (350pt after the page's 20pt side padding).
struct FlowLayoutTests {
    let chips = [71.3, 61.2, 54.4, 64.1, 58.6].map { CGSize(width: $0, height: 34) }

    @Test func reportsTheFullOfferedWidth() {
        let size = FlowLayout.size(for: chips, proposedWidth: 350, spacing: 8)
        #expect(size.width == 350)
    }

    @Test func reservesTheSameRowsItDraws() {
        // SwiftUI places the layout in bounds of the size it reported, snapped to the
        // pixel grid; placement must wrap into exactly the rows that were sized for.
        for offered in stride(from: 300.0, through: 360.0, by: 1.0) {
            let size = FlowLayout.size(for: chips, proposedWidth: offered, spacing: 8)
            let snapped = (size.width * 3).rounded(.down) / 3
            let drawn = FlowLayout.rows(for: chips, maxWidth: snapped, spacing: 8)
            #expect(drawn.last.map { $0.y + $0.height } == size.height, "offered \(offered)")
        }
    }

    @Test func wrapsWhenTheChipsDoNotFit() {
        let rows = FlowLayout.rows(for: chips, maxWidth: 250, spacing: 8)
        #expect(rows.map(\.indices) == [[0, 1, 2], [3, 4]])
        #expect(FlowLayout.size(for: chips, proposedWidth: 250, spacing: 8).height == 34 + 8 + 34)
    }

    @Test func openEndedWidthUsesTheWidestRow() {
        let size = FlowLayout.size(for: chips, proposedWidth: nil, spacing: 8)
        #expect(size.height == 34)
        #expect(abs(size.width - (71.3 + 61.2 + 54.4 + 64.1 + 58.6 + 4 * 8)) < 0.001)
    }
}
