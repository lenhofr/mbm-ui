import SwiftUI
import PhotosUI
import VisionKit

// The AI import flow, ported from AddSheets.tsx and ImportScreens.tsx in mbm-ui:
// pick a source → read it with AI → review in the editor.

/// "Add a recipe" options (AddSheet in AddSheets.tsx).
struct AddRecipeSheet: View {
    enum Choice { case scan, paste, manual }

    let onChoose: (Choice) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Add a recipe")
                .font(.poppins(22))
                .foregroundStyle(Color.plum)
                .padding(.bottom, 4)
            if DocumentScanner.isAvailable {
                AddOption(icon: "camera", title: "Scan a recipe card", subtitle: "Handwritten, printed or a cookbook page", hero: true) {
                    onChoose(.scan)
                }
            }
            AddOption(icon: "doc.on.clipboard", title: "Paste a link, text or screenshot", subtitle: "We’ll work out which it is") {
                onChoose(.paste)
            }
            AddOption(icon: "pencil", title: "Type it yourself", subtitle: "Start from a blank recipe") {
                onChoose(.manual)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 24)
        .frame(maxHeight: .infinity, alignment: .top)
        .presentationDetents([.height(DocumentScanner.isAvailable ? 360 : 280)])
        .presentationBackground(Color.appBackground)
        .presentationDragIndicator(.visible)
    }
}

private struct AddOption: View {
    let icon: String
    let title: String
    let subtitle: String
    var hero = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: icon)
                    .font(.system(size: 21))
                    .foregroundStyle(hero ? .white : Color.plum)
                    .frame(width: 50, height: 50)
                    .background(hero ? Color.white.opacity(0.16) : Color.chip, in: RoundedRectangle(cornerRadius: 15))
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.inter(16, weight: .semibold))
                        .foregroundStyle(hero ? .white : Color.text)
                    Text(subtitle)
                        .font(.inter(13.5))
                        .foregroundStyle(hero ? .white.opacity(0.82) : Color.muted)
                }
                .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(hero ? .white.opacity(0.8) : Color.muted)
            }
            .padding(14)
            .background(hero ? Color.plum : Color.surface, in: RoundedRectangle(cornerRadius: 20))
            .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(hero ? Color.plum : Color.line))
        }
        .buttonStyle(PressableStyle())
    }
}

/// Paste a link, recipe text or a screenshot (PasteSheet in AddSheets.tsx).
struct PasteSheet: View {
    let onImport: (ImportJob) -> Void

    @State private var text = ""
    @State private var screenshot: UIImage?
    @State private var photoItem: PhotosPickerItem?
    @State private var note: String?
    @FocusState private var focused: Bool

    private var detected: ImportJob.Kind? {
        if let screenshot { return .screenshot(screenshot) }
        return ImportJob.detect(text)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Paste anything")
                .font(.poppins(22))
                .foregroundStyle(Color.plum)
            Text("A recipe link, the recipe text itself, or a screenshot.")
                .font(.inter(15))
                .foregroundStyle(Color.muted)
                .padding(.top, 6)
                .padding(.bottom, 14)

            if let screenshot {
                HStack(spacing: 14) {
                    Image(uiImage: screenshot)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 72, height: 100)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color.line))
                    Button("Remove") { self.screenshot = nil }
                        .font(.inter(16, weight: .medium))
                        .foregroundStyle(Color.plum)
                    Spacer()
                }
                .padding(14)
                .background(Color.surface, in: RoundedRectangle(cornerRadius: 16))
                .overlay(dashedBorder)
            } else {
                TextField("Paste here…", text: $text, axis: .vertical)
                    .font(.inter(16))
                    .foregroundStyle(Color.text)
                    .lineLimit(4...8)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focused)
                    .padding(14)
                    .background(Color.surface, in: RoundedRectangle(cornerRadius: 16))
                    .overlay(focused ? AnyView(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.plum, lineWidth: 1.5)) : AnyView(dashedBorder))
            }

            if text.isEmpty && screenshot == nil {
                HStack(spacing: 8) {
                    // PasteButton reads the clipboard without iOS's "Allow Paste?" prompt.
                    PasteButton(payloadType: String.self) { strings in
                        if let first = strings.first { text = first }
                    }
                    .buttonBorderShape(.roundedRectangle(radius: 14))
                    .tint(Color.chip)
                    .foregroundStyle(Color.plum)
                    .labelStyle(.titleAndIcon)
                    .frame(maxWidth: .infinity)

                    PhotosPicker(selection: $photoItem, matching: .screenshots) {
                        Label("Screenshot", systemImage: "photo")
                            .font(.inter(14, weight: .semibold))
                            .foregroundStyle(Color.plum)
                            .frame(maxWidth: .infinity, minHeight: 46)
                            .background(Color.chip, in: RoundedRectangle(cornerRadius: 14))
                    }
                }
                .padding(.top, 10)
            }

            if let note {
                Text(note)
                    .font(.inter(13.5))
                    .foregroundStyle(Color.muted)
                    .padding(.top, 10)
            }

            if let detected {
                HStack(spacing: 10) {
                    Image(systemName: icon(for: detected))
                        .foregroundStyle(Color.plum)
                    HStack(spacing: 0) {
                        Text(label(for: detected)).font(.inter(15, weight: .bold))
                        Text(" · " + detail(for: detected)).font(.inter(15))
                    }
                    .foregroundStyle(Color.text)
                    .lineLimit(1)
                    Spacer(minLength: 0)
                    Image(systemName: "checkmark")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Color.ok)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(Color.surface, in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Color.line))
                .padding(.top, 12)
            }

            Button {
                if let detected { onImport(ImportJob(kind: detected)) }
            } label: {
                Label("Import recipe", systemImage: "sparkles")
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(detected == nil)
            .opacity(detected == nil ? 0.4 : 1)
            .padding(.top, 14)

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 20)
        .padding(.top, 24)
        .presentationDetents([.medium, .large])
        .presentationBackground(Color.appBackground)
        .presentationDragIndicator(.visible)
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
                    screenshot = image
                    note = nil
                } else {
                    note = "We couldn’t read that image. Try a different one."
                }
                photoItem = nil
            }
        }
    }

    private var dashedBorder: some View {
        RoundedRectangle(cornerRadius: 16)
            .strokeBorder(Color.dash, style: StrokeStyle(lineWidth: 1.5, dash: [6, 4]))
    }

    private func icon(for kind: ImportJob.Kind) -> String {
        switch kind {
        case .link: "link"
        case .screenshot: "photo"
        default: "text.alignleft"
        }
    }

    private func label(for kind: ImportJob.Kind) -> String {
        switch kind {
        case .link: "Link"
        case .screenshot: "Screenshot"
        default: "Recipe text"
        }
    }

    private func detail(for kind: ImportJob.Kind) -> String {
        switch kind {
        case .link(let url):
            return ImportJob.host(of: url)
        case .screenshot:
            return "From your photos"
        case .text(let s):
            let words = s.split(whereSeparator: \.isWhitespace).count
            return "\(words) \(words == 1 ? "word" : "words")"
        case .scan:
            return ""
        }
    }
}

/// Reads a job with AI, then hands the result to the editor (ProcessingScreen /
/// ScanFailedScreen in ImportScreens.tsx).
struct ImportFlowView: View {
    @Environment(AuthModel.self) private var auth
    @Environment(RecipeStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State var job: ImportJob
    let onSaved: (Recipe) -> Void

    private enum Phase { case reading, failed, unreadableScan, review(RecipeDraft) }

    @State private var phase: Phase = .reading
    @State private var attempt = 0
    @State private var showScanner = false
    @State private var retakePages: [UIImage]?

    var body: some View {
        Group {
            switch phase {
            case .review(let draft):
                RecipeEditorView(draft: draft, onSaved: onSaved)
            case .unreadableScan:
                UnreadableScanView(
                    onRetake: { showScanner = true },
                    onTypeIt: { phase = .review(RecipeDraft()) },
                    onClose: { dismiss() }
                )
            case .reading, .failed:
                ProcessingView(
                    job: job,
                    failed: { if case .failed = phase { true } else { false } }(),
                    onRetry: {
                        phase = .reading
                        attempt += 1
                    },
                    onTypeIt: { phase = .review(RecipeDraft()) },
                    onCancel: { dismiss() }
                )
            }
        }
        .background(Color.appBackground)
        .task(id: attempt) { await read() }
        .fullScreenCover(isPresented: $showScanner, onDismiss: {
            guard let pages = retakePages else { return }
            retakePages = nil
            job = ImportJob(kind: .scan(pages))
            phase = .reading
            attempt += 1
        }) {
            DocumentScanner { pages in retakePages = pages }
                .ignoresSafeArea()
        }
    }

    private func read() async {
        guard case .reading = phase else { return }
        let thisAttempt = attempt
        // Only the latest, still-running request may change the screen; a cancelled
        // or superseded one (e.g. after Try again) must not flash an error.
        func isCurrent() -> Bool { !Task.isCancelled && thisAttempt == attempt }

        guard let token = await auth.idToken() else {
            if isCurrent() { phase = .failed }
            return
        }
        do {
            let result = try await ExtractAPI.extract(job, token: token, knownTags: store.topTags(limit: 30))
            guard isCurrent() else { return }
            withAnimation { phase = .review(RecipeDraft(extract: result, job: job)) }
        } catch ExtractAPI.ExtractError.unreadable where job.source == .scan {
            if isCurrent() { phase = .unreadableScan }
        } catch {
            // URLSession reports cancellation as URLError.cancelled, not CancellationError.
            let cancelled = error is CancellationError || (error as? URLError)?.code == .cancelled
            guard !cancelled, isCurrent() else { return }
            withAnimation { phase = .failed }
        }
    }
}

/// "Reading your card…" with a ticking checklist (the API doesn't stream progress,
/// so steps advance on a timer and hold on the last one).
private struct ProcessingView: View {
    let job: ImportJob
    let failed: Bool
    let onRetry: () -> Void
    let onTypeIt: () -> Void
    let onCancel: () -> Void

    @State private var step = 0
    @State private var steps: [String] = []
    @State private var title = ""
    @State private var failTitle = ["That one fell flat", "Kitchen hiccup", "That didn’t work"].randomElement()!

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
                Button("Cancel", action: onCancel)
                    .font(.inter(17, weight: .medium))
                    .foregroundStyle(Color.plum)
            }
            .frame(height: 48)

            visual
                .frame(height: 250)

            Text(failed ? failTitle : title)
                .font(.poppins(24))
                .foregroundStyle(Color.plum)
                .multilineTextAlignment(.center)
                .padding(.top, 8)
                .padding(.bottom, 22)

            if failed {
                Text(failedMessage)
                    .font(.inter(15))
                    .foregroundStyle(Color.muted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 8)
                Spacer()
                VStack(spacing: 6) {
                    Button("Try again", action: onRetry)
                        .buttonStyle(PrimaryButtonStyle())
                    Button("Type it in instead", action: onTypeIt)
                        .font(.inter(16, weight: .semibold))
                        .foregroundStyle(Color.plum)
                        .frame(maxWidth: .infinity, minHeight: 48)
                }
            } else {
                VStack(alignment: .leading, spacing: 16) {
                    ForEach(Array(steps.enumerated()), id: \.offset) { index, text in
                        StepLine(text: text, state: index < step ? .done : index == step ? .now : .waiting)
                    }
                }
                .frame(width: 260, alignment: .leading)
                Spacer()
            }
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 24)
        .onAppear(perform: pickCopy)
        .task(id: failed) {
            guard !failed else { return }
            step = 0
            while step < steps.count - 1 {
                try? await Task.sleep(for: .seconds(1.4))
                if Task.isCancelled { return }
                withAnimation(.easeOut(duration: 0.3)) { step += 1 }
            }
        }
    }

    private var failedMessage: String {
        if case .scan = job.kind {
            return "Something boiled over on our end. Give it another try in a moment."
        }
        return "We couldn’t get a recipe from that. Try again, or type it in."
    }

    @ViewBuilder
    private var visual: some View {
        if case .scan(let pages) = job.kind, let first = pages.first {
            Image(uiImage: first)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: 250, maxHeight: 210)
                .overlay { if !failed { ScanLine() } }
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .rotationEffect(.degrees(-2))
                .shadow(color: .black.opacity(0.25), radius: 13, y: 10)
        } else {
            VStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 28))
                Text(label)
                    .font(.inter(16, weight: .semibold))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }
            .foregroundStyle(Color.plum)
            .padding(.horizontal, 16)
            .frame(width: 240, height: 150)
            .background(Color.surface)
            .overlay { if !failed { ScanLine() } }
            .clipShape(RoundedRectangle(cornerRadius: 22))
            .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(Color.line))
        }
    }

    private var icon: String {
        switch job.kind {
        case .screenshot: "photo"
        case .text: "text.alignleft"
        default: "link"
        }
    }

    private var label: String {
        switch job.kind {
        case .link: job.host ?? "Link"
        case .screenshot: "Screenshot"
        default: "Recipe text"
        }
    }

    /// Picks one wording per step, once (talk.*Steps in kitchenTalk.ts).
    private func pickCopy() {
        guard steps.isEmpty else { return }
        let banks: [[String]]
        switch job.kind {
        case .scan(let pages):
            title = (pages.count > 1
                ? ["Reading both sides…", "Squinting at the handwriting…", "Studying your recipe cards…"]
                : ["Squinting at the handwriting…", "Reading your card…", "Studying the recipe card…"]).randomElement()!
            banks = [
                ["Deciphering the handwriting", "Reading the handwriting"],
                ["Measuring out the ingredients", "Finding the ingredients"],
                ["Writing out the steps"],
                ["Sprinkling on some tags", "Suggesting tags"],
            ]
        case .screenshot:
            title = ["Prepping your recipe…", "Chopping up the page…", "Importing…"].randomElement()!
            banks = [
                ["Reading the screenshot"],
                ["Measuring out the ingredients", "Finding the ingredients"],
                ["Writing out the steps"],
                ["Sprinkling on some tags", "Suggesting tags"],
            ]
        case .link, .text:
            title = ["Prepping your recipe…", "Chopping up the page…", "Importing…"].randomElement()!
            banks = [
                ["Opening the page"],
                ["Scrolling past the life story", "Dodging the pop-up ads", "Skipping the life story"],
                ["Gathering the ingredients", "Finding the ingredients"],
                ["Writing out the steps"],
            ]
        }
        steps = banks.map { $0.randomElement()! }
    }
}

private struct StepLine: View {
    enum Status { case waiting, now, done }

    let text: String
    let state: Status

    @State private var spin = false

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                switch state {
                case .done:
                    Circle().fill(Color.ok)
                    Image(systemName: "checkmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.white)
                case .now:
                    Circle()
                        .trim(from: 0, to: 0.75)
                        .stroke(Color.pink, lineWidth: 2)
                        .rotationEffect(.degrees(spin ? 360 : 0))
                        .onAppear {
                            withAnimation(.linear(duration: 0.8).repeatForever(autoreverses: false)) { spin = true }
                        }
                case .waiting:
                    Circle().strokeBorder(Color(hex: 0xBBA9B2), lineWidth: 2)
                }
            }
            .frame(width: 24, height: 24)
            Text(text)
                .font(.inter(16, weight: state == .now ? .semibold : .regular))
                .foregroundStyle(state == .waiting ? Color(hex: 0xBBA9B2) : Color.text)
        }
    }
}

/// Pink scan line sweeping down the card (`.scanline` in ImportScreens.css).
private struct ScanLine: View {
    @State private var down = false

    var body: some View {
        GeometryReader { geo in
            LinearGradient(colors: [.clear, Color.pink.opacity(0.22)], startPoint: .top, endPoint: .bottom)
                .frame(height: 50)
                .overlay(alignment: .bottom) { Color.pink.frame(height: 2) }
                .offset(y: down ? geo.size.height - 20 : -40)
                .onAppear {
                    withAnimation(.easeInOut(duration: 1.4).repeatForever(autoreverses: true)) { down = true }
                }
        }
        .allowsHitTesting(false)
    }
}

/// Shown when the AI can't read a scanned card (ScanFailedScreen).
private struct UnreadableScanView: View {
    let onRetake: () -> Void
    let onTypeIt: () -> Void
    let onClose: () -> Void

    @State private var title = ["We couldn’t read this one", "Too smudged to read", "Foggier than a steamy kitchen window"].randomElement()!

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Color.plum)
                        .frame(width: 44, height: 44)
                        .background(Color.chip, in: Circle())
                }
                .accessibilityLabel("Close")
                Spacer()
            }
            .frame(height: 48)

            Image(systemName: "photo")
                .font(.system(size: 44))
                .foregroundStyle(Color(hex: 0x9AA5C4))
                .frame(width: 220, height: 150)
                .background(Color(hex: 0xFFFDF6), in: RoundedRectangle(cornerRadius: 6))
                .blur(radius: 2.6)
                .rotationEffect(.degrees(-2))
                .shadow(color: .black.opacity(0.2), radius: 13, y: 10)
                .frame(height: 250)

            Text(title)
                .font(.poppins(24))
                .foregroundStyle(Color.plum)
                .multilineTextAlignment(.center)
                .padding(.bottom, 12)
            Text("The photo is too blurry to make out the words. A few things that help:")
                .font(.inter(15))
                .foregroundStyle(Color.muted)
                .multilineTextAlignment(.center)
                .padding(.bottom, 18)

            VStack(alignment: .leading, spacing: 14) {
                tip("sun.max", "Use more light, and avoid glare from the flash")
                tip("camera", "Fill the frame with just the card")
                tip("clock", "Hold still for a second after tapping")
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.surface, in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color.line))

            Spacer()
            VStack(spacing: 6) {
                Button(action: onRetake) { Label("Retake photo", systemImage: "camera") }
                    .buttonStyle(PrimaryButtonStyle())
                Button("Type it in instead", action: onTypeIt)
                    .font(.inter(16, weight: .semibold))
                    .foregroundStyle(Color.plum)
                    .frame(maxWidth: .infinity, minHeight: 48)
            }
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 24)
    }

    private func tip(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 18))
                .foregroundStyle(Color.plum)
                .frame(width: 24)
            Text(text)
                .font(.inter(15))
                .foregroundStyle(Color.text)
        }
    }
}

/// Apple's document scanner (the one in Notes): finds the card's edges, flattens
/// it, and can capture several pages, e.g. the front and back of a card.
struct DocumentScanner: UIViewControllerRepresentable {
    static var isAvailable: Bool { VNDocumentCameraViewController.isSupported }

    let onScan: ([UIImage]) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let scanner = VNDocumentCameraViewController()
        scanner.delegate = context.coordinator
        return scanner
    }

    func updateUIViewController(_ controller: VNDocumentCameraViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        let parent: DocumentScanner

        init(_ parent: DocumentScanner) { self.parent = parent }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
            // The API reads up to 4 pages at once.
            let pages = (0..<min(scan.pageCount, 4)).map { scan.imageOfPage(at: $0) }
            parent.dismiss()
            if !pages.isEmpty { parent.onScan(pages) }
        }

        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
            parent.dismiss()
        }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
            parent.dismiss()
        }
    }
}
