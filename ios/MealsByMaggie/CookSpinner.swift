import SwiftUI

/// The bobbing cooking pot used while recipes load (CookSpinner.tsx / CookSpinner.css).
struct CookSpinner: View {
    var size: CGFloat = 40

    @State private var bob = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        CookingPot()
            .stroke(Color.plum, style: StrokeStyle(lineWidth: size * 16 / 256, lineCap: .round, lineJoin: .round))
            .frame(width: size, height: size)
            .shadow(color: .black.opacity(0.12), radius: 4, y: 2)
            // cook-bob: lift slightly and rock between -2° and 2°.
            .rotationEffect(.degrees(bob ? 2 : -2))
            .offset(y: bob ? -size / 20 : 0)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 1.15 / 2).repeatForever(autoreverses: true)) { bob = true }
            }
            .accessibilityElement()
            .accessibilityLabel("Loading")
    }
}

/// Phosphor's "CookingPot" icon (regular weight), the same one the web app uses,
/// drawn on its 256×256 grid: three wisps of steam, the pot and two handles.
struct CookingPot: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        func line(_ x1: CGFloat, _ y1: CGFloat, _ x2: CGFloat, _ y2: CGFloat) {
            path.move(to: CGPoint(x: x1, y: y1))
            path.addLine(to: CGPoint(x: x2, y: y2))
        }
        // Steam
        line(96, 16, 96, 48)
        line(128, 16, 128, 48)
        line(160, 16, 160, 48)
        // Pot: square-ish top corners, rounder bottom
        path.addPath(UnevenRoundedRectangle(
            topLeadingRadius: 8, bottomLeadingRadius: 24, bottomTrailingRadius: 24, topTrailingRadius: 8
        ).path(in: CGRect(x: 40, y: 80, width: 176, height: 128)))
        // Handles
        line(248, 96, 216, 120)
        line(8, 96, 40, 120)

        let scale = min(rect.width, rect.height) / 256
        return path.applying(
            CGAffineTransform(translationX: rect.minX, y: rect.minY).scaledBy(x: scale, y: scale)
        )
    }
}

/// Phosphor's "PencilSimple" icon (bold), the web's edit button: a pencil outline with a
/// line across near the top right marking the eraser. Drawn on the same 256×256 grid.
struct PencilSimple: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        // Outline from the writing end (bottom left) up to the eraser end (top right).
        path.move(to: CGPoint(x: 96, y: 216))
        path.addLine(to: CGPoint(x: 40, y: 216))
        path.addLine(to: CGPoint(x: 40, y: 160))
        path.addLine(to: CGPoint(x: 168, y: 32))
        path.addLine(to: CGPoint(x: 224, y: 88))
        path.closeSubpath()
        path.move(to: CGPoint(x: 136, y: 64))
        path.addLine(to: CGPoint(x: 192, y: 120))

        let scale = min(rect.width, rect.height) / 256
        return path.applying(
            CGAffineTransform(translationX: rect.minX, y: rect.minY).scaledBy(x: scale, y: scale)
        )
    }
}

#Preview {
    VStack(spacing: 12) {
        CookSpinner()
        Text("Simmering…").font(.inter(15)).foregroundStyle(Color.muted)
    }
}
