import SwiftUI

/// Tappable ingredient rows (IngredientChecklist.tsx in mbm-ui). `used` (detail screen,
/// cook mode): plum check + strikethrough. `have` (pantry quick view): green check +
/// muted text, no strikethrough.
struct IngredientChecklist: View {
    enum Variant { case used, have }

    let ingredients: [Recipe.Ingredient]
    @Binding var checked: Set<Int>
    var variant = Variant.used
    var large = false
    /// Scales amounts when the servings are changed (1 = as written).
    var multiplier: Double = 1

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(ingredients.enumerated()), id: \.offset) { index, item in
                let done = checked.contains(index)
                Button {
                    if done { checked.remove(index) } else { checked.insert(index) }
                } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        CheckBox(done: done, color: variant == .have ? Color.ok : Color.plum)
                            .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 5 }
                        Text(item.displayText(scaledBy: multiplier))
                            .font(.inter(large ? 17 : 16))
                            .foregroundStyle(done ? (variant == .have ? Color.muted : Color(hex: 0xB9A6B0)) : Color.text)
                            .strikethrough(done && variant == .used)
                            .multilineTextAlignment(.leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.vertical, 12)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .overlay(alignment: .bottom) {
                    Color.line.frame(height: 1)
                }
                .animation(.easeOut(duration: 0.15), value: done)
                .sensoryFeedback(.selection, trigger: done)
            }
        }
    }
}

private struct CheckBox: View {
    let done: Bool
    let color: Color

    var body: some View {
        RoundedRectangle(cornerRadius: 7)
            .strokeBorder(done ? color : Color.dash, lineWidth: 2)
            .background(done ? color : Color.clear, in: RoundedRectangle(cornerRadius: 7))
            .overlay {
                if done {
                    Image(systemName: "checkmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.white)
                }
            }
            .frame(width: 22, height: 22)
    }
}

extension Recipe.Ingredient {
    /// "1/2 cup ranch dressing" — amount first, when there is one.
    var displayText: String {
        [amount, name].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " ")
    }
}
