import SwiftUI

// Cook mode, styled after CookScreen.tsx / CookScreen.css in mbm-ui:
// big text, tick off ingredients and steps, and the screen stays on.
struct CookView: View {
    let recipe: Recipe
    @Environment(\.dismiss) private var dismiss

    @State private var checked: Set<Int> = []
    @State private var doneSteps: Set<Int> = []
    @State private var finished = false
    @State private var progressLoaded = false

    private var steps: [String] { recipe.instructions ?? [] }
    private var ingredients: [Recipe.Ingredient] { recipe.ingredients ?? [] }
    private var currentStep: Int? { steps.indices.first { !doneSteps.contains($0) } }

    var body: some View {
        Group {
            if finished {
                CookDoneView(recipe: recipe, onBack: { dismiss() }, onStartOver: startOver)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            } else {
                cooking
            }
        }
        .background(Color(hex: 0xFFFAFC))
        .animation(.easeOut(duration: 0.3), value: finished)
        .sensoryFeedback(.success, trigger: finished) { _, isFinished in isFinished }
        .onAppear {
            if let saved = CookProgress.load(recipe.id) {
                checked = saved.ingredients
                doneSteps = saved.steps
            }
            progressLoaded = true
            setScreenAwake(true)
        }
        .onDisappear { setScreenAwake(false) }
        .onChange(of: finished) { _, isFinished in setScreenAwake(!isFinished) }
        .onChange(of: checked) { saveProgress() }
        .onChange(of: doneSteps) { saveProgress() }
    }

    private var cooking: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text(recipe.title)
                        .font(.poppins(24))
                        .foregroundStyle(Color.plum)
                        .padding(.top, 4)
                    if let meta {
                        Text(meta)
                            .font(.inter(13))
                            .foregroundStyle(Color.muted)
                            .padding(.top, 6)
                    }

                    if !ingredients.isEmpty {
                        SectionLabel(title: "Ingredients")
                        IngredientChecklist(ingredients: ingredients, checked: $checked, large: true)
                    }

                    SectionLabel(title: "Steps", hint: "tap a step when it’s done")
                    VStack(spacing: 10) {
                        ForEach(Array(steps.enumerated()), id: \.offset) { index, text in
                            StepCard(
                                number: index + 1,
                                text: text,
                                done: doneSteps.contains(index),
                                current: index == currentStep
                            ) {
                                if doneSteps.contains(index) { doneSteps.remove(index) } else { doneSteps.insert(index) }
                            }
                        }
                    }

                    Button("Finish", action: finish)
                        .buttonStyle(PrimaryButtonStyle())
                        .padding(.top, 22)
                        .padding(.bottom, 20)
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
            }
            .scrollIndicators(.hidden)
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.plum)
                    .frame(width: 44, height: 44)
                    .background(Color.chip, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Exit cook mode")

            Spacer()
            Text(doneSteps.count == steps.count ? "All done, hit Finish!" : "\(doneSteps.count) of \(steps.count) steps done")
                .font(.inter(14, weight: .semibold))
                .foregroundStyle(Color.muted)
                .contentTransition(.numericText())
                .animation(.default, value: doneSteps.count)
            Spacer()

            Label("Screen on", systemImage: "sun.max.fill")
                .labelStyle(.titleAndIcon)
                .font(.inter(12, weight: .semibold))
                .foregroundStyle(Color.ok)
                .padding(.horizontal, 11)
                .padding(.vertical, 8)
                .background(Color(hex: 0xE7F3EC), in: Capsule())
        }
        .padding(.horizontal, 20)
        .padding(.top, 4)
        .padding(.bottom, 10)
    }

    private var meta: String? {
        let parts = [recipe.cookTime, recipe.servings.map { "serves \($0)" }]
            .compactMap { $0?.isEmpty == false ? $0 : nil }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func finish() {
        CookProgress.clear(recipe.id)
        finished = true
    }

    private func startOver() {
        checked = []
        doneSteps = []
        finished = false
    }

    private func saveProgress() {
        guard progressLoaded, !finished else { return }
        CookProgress.save(recipe.id, ingredients: checked, steps: doneSteps)
    }

    /// Stops the phone from dimming/locking while cooking (useWakeLock in mbm-ui).
    private func setScreenAwake(_ awake: Bool) {
        UIApplication.shared.isIdleTimerDisabled = awake
    }
}

/// White card per step; plum border on the current one, faded with a green check when done.
private struct StepCard: View {
    let number: Int
    let text: String
    let done: Bool
    let current: Bool
    let toggle: () -> Void

    var body: some View {
        Button(action: toggle) {
            HStack(alignment: .top, spacing: 12) {
                ZStack {
                    Circle().fill(done ? Color.ok : Color.chip)
                    if done {
                        Image(systemName: "checkmark")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(.white)
                    } else {
                        Text("\(number)")
                            .font(.inter(14, weight: .bold))
                            .foregroundStyle(Color.plum)
                    }
                }
                .frame(width: 30, height: 30)

                Text(text)
                    .font(.inter(18))
                    .foregroundStyle(Color.text)
                    .lineSpacing(6)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 2)
            }
            .padding(14)
            .background(Color.surface, in: RoundedRectangle(cornerRadius: 18))
            .overlay(
                RoundedRectangle(cornerRadius: 18)
                    .strokeBorder(current ? Color.plum : Color.line, lineWidth: 1.5)
            )
            .opacity(done ? 0.5 : 1)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .animation(.easeOut(duration: 0.2), value: done)
        .animation(.easeOut(duration: 0.2), value: current)
        .sensoryFeedback(.selection, trigger: done)
        .accessibilityLabel("Step \(number)\(done ? ", done" : "")")
    }
}

/// Uppercase small label (`.sec-label` in tokens.css) with an optional hint.
private struct SectionLabel: View {
    let title: String
    var hint: String?

    var body: some View {
        HStack(spacing: 6) {
            Text(title.uppercased())
                .font(.inter(12.5, weight: .semibold))
                .tracking(0.9)
                .foregroundStyle(Color.muted)
            if let hint {
                Text(hint)
                    .font(.inter(12.5, weight: .medium))
                    .foregroundStyle(Color(hex: 0xB39EA9))
            }
        }
        .padding(.horizontal, 2)
        .padding(.top, 20)
        .padding(.bottom, 8)
    }
}

/// "Chef's kiss!" celebration once you hit Finish.
private struct CookDoneView: View {
    let recipe: Recipe
    let onBack: () -> Void
    let onStartOver: () -> Void

    // Picked once, so the line doesn't change under you (kitchenTalk.ts in mbm-ui).
    @State private var title = ["Chef’s kiss!", "Nailed it!", "Kitchen hero!", "Order up!", "Gordon would be proud", "Five stars from the kitchen"].randomElement()!
    @State private var subtitle = ["Enjoy your {title}.", "{title} is served.", "Go ahead, lick the spoon.", "Time to dig in."].randomElement()!

    var body: some View {
        VStack(spacing: 10) {
            Spacer()
            Image(systemName: "checkmark")
                .font(.system(size: 36, weight: .bold))
                .foregroundStyle(Color.ok)
                .frame(width: 90, height: 90)
                .background(Color(hex: 0xE7F3EC), in: Circle())
                .padding(.bottom, 8)
            Text(title)
                .font(.poppins(30))
                .foregroundStyle(Color.plum)
                .multilineTextAlignment(.center)
            Text(subtitle.replacingOccurrences(of: "{title}", with: recipe.title))
                .font(.inter(17))
                .foregroundStyle(Color.muted)
                .multilineTextAlignment(.center)
                .padding(.bottom, 24)
            Button("Back to recipe", action: onBack)
                .buttonStyle(PrimaryButtonStyle())
            Button("Start over", action: onStartOver)
                .font(.inter(16, weight: .semibold))
                .foregroundStyle(Color.plum)
                .frame(maxWidth: .infinity, minHeight: 48)
            Spacer()
        }
        .padding(.horizontal, 20)
    }
}

/// Large solid plum button (`.btn.primary.block.lg` in tokens.css).
struct PrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.inter(17, weight: .semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 56)
            .background(configuration.isPressed ? Color.plum2 : Color.plum, in: RoundedRectangle(cornerRadius: 16))
    }
}

/// Checked ingredients and done steps survive closing cook mode by accident,
/// until you hit Finish (sessionStorage in mbm-ui; UserDefaults here).
enum CookProgress {
    private struct Saved: Codable { var ingredients: [Int]; var steps: [Int] }

    private static func key(_ id: String) -> String { "mbm:cook:\(id)" }

    static func load(_ id: String) -> (ingredients: Set<Int>, steps: Set<Int>)? {
        guard let data = UserDefaults.standard.data(forKey: key(id)),
              let saved = try? JSONDecoder().decode(Saved.self, from: data) else { return nil }
        return (Set(saved.ingredients), Set(saved.steps))
    }

    static func save(_ id: String, ingredients: Set<Int>, steps: Set<Int>) {
        let saved = Saved(ingredients: ingredients.sorted(), steps: steps.sorted())
        UserDefaults.standard.set(try? JSONEncoder().encode(saved), forKey: key(id))
    }

    static func clear(_ id: String) {
        UserDefaults.standard.removeObject(forKey: key(id))
    }
}

#Preview {
    CookView(recipe: Recipe(
        id: "preview",
        title: "Crockpot Chicken Pasta",
        tags: ["crockpot"],
        ingredients: [.init(name: "pasta", amount: "1 box"), .init(name: "marinara", amount: "28 oz")],
        servings: "4",
        cookTime: "3 hours",
        instructions: ["Mix everything in the crockpot.", "Cook on high for 3 hours.", "Stir in the cooked pasta and serve."]
    ))
}
