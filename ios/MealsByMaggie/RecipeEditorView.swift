import SwiftUI
import PhotosUI

// Add / edit a recipe, styled after EditorScreen.tsx / EditorScreen.css in mbm-ui.
struct RecipeEditorView: View {
    @Environment(AuthModel.self) private var auth
    @Environment(RecipeStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var draft: RecipeDraft
    /// Called after a successful save with the saved recipe.
    var onSaved: (Recipe) -> Void = { _ in }
    /// Called after the recipe is deleted.
    var onDeleted: () -> Void = {}

    @State private var tagInput = ""
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var confirmDelete = false
    @State private var photoItem: PhotosPickerItem?
    @State private var showLibrary = false
    @State private var showCamera = false
    @FocusState private var focusedRow: UUID?
    @FocusState private var tagFieldFocused: Bool

    init(draft: RecipeDraft, onSaved: @escaping (Recipe) -> Void = { _ in }, onDeleted: @escaping () -> Void = {}) {
        _draft = State(initialValue: draft)
        self.onSaved = onSaved
        self.onDeleted = onDeleted
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if let errorMessage {
                        Text(errorMessage)
                            .font(.inter(14))
                            .foregroundStyle(Color(hex: 0x8A4A0C))
                            .padding(.horizontal, 14)
                            .padding(.vertical, 12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(hex: 0xFDF0DC), in: RoundedRectangle(cornerRadius: 14))
                            .padding(.bottom, 16)
                    }

                    photoSlot
                        .padding(.bottom, 16)

                    EditorField(label: "Title") {
                        TextField("e.g. Chocolate Cake", text: $draft.title)
                            .font(.poppins(18))
                            .foregroundStyle(Color.plum)
                            .textInputAutocapitalization(.words)
                            .inputBox()
                    }
                    EditorField(label: "Description") {
                        TextField("Optional", text: $draft.description, axis: .vertical)
                            .font(.inter(16))
                            .lineLimit(1...4)
                            .inputBox()
                    }
                    HStack(alignment: .top, spacing: 12) {
                        EditorField(label: "Time") {
                            TextField("30 min", text: $draft.cookTime)
                                .font(.inter(16))
                                .inputBox()
                        }
                        EditorField(label: "Servings") {
                            ServingsStepper(value: $draft.servings)
                        }
                    }
                    EditorField(label: "Tags") { tagEditor }

                    SectionHeading(title: "Ingredients")
                    rowsBox(rows: $draft.ingredients, placeholder: "1 cup flour", addTitle: "Add ingredient", numbered: false)

                    SectionHeading(title: "Steps")
                    rowsBox(rows: $draft.steps, placeholder: "Describe this step", addTitle: "Add step", numbered: true)

                    if draft.isEdit {
                        Button(role: .destructive) {
                            confirmDelete = true
                        } label: {
                            Label("Delete recipe", systemImage: "trash")
                                .font(.inter(16, weight: .semibold))
                                .foregroundStyle(Color(hex: 0xB4233C))
                                .frame(maxWidth: .infinity, minHeight: 48)
                        }
                        .padding(.top, 28)
                    }
                }
                .padding(16)
                .padding(.bottom, 40)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Color.appBackground)
            .navigationTitle(draft.isEdit ? "Edit recipe" : "New recipe")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color.appBackground, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button("Save", action: save)
                            .fontWeight(.bold)
                            .disabled(!draft.canSave)
                    }
                }
            }
            .interactiveDismissDisabled(isSaving)
            .photosPicker(isPresented: $showLibrary, selection: $photoItem, matching: .images)
            .onChange(of: photoItem) { _, item in loadPhoto(item) }
            .fullScreenCover(isPresented: $showCamera) {
                CameraPicker { image in draft.newPhoto = image }
                    .ignoresSafeArea()
            }
            .confirmationDialog("Are you sure you want to 86 this recipe?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete “\(draft.title)”", role: .destructive, action: delete)
            }
        }
    }

    // MARK: Photo

    private var photoSlot: some View {
        Menu {
            if CameraPicker.isAvailable {
                Button("Take photo", systemImage: "camera") { showCamera = true }
            }
            Button("Choose from library", systemImage: "photo.on.rectangle") { showLibrary = true }
            if draft.newPhoto != nil || draft.image != nil {
                Button("Remove photo", systemImage: "trash", role: .destructive) {
                    draft.newPhoto = nil
                    draft.image = nil
                }
            }
        } label: {
            if hasPhoto {
                Color.clear
                    .frame(height: 190)
                    .overlay { photoPreview }
                    .clipShape(RoundedRectangle(cornerRadius: 18))
                    .overlay(alignment: .bottomTrailing) {
                        Label("Change photo", systemImage: "camera")
                            .font(.inter(13, weight: .medium))
                            .foregroundStyle(Color.plum)
                            .padding(.horizontal, 11)
                            .padding(.vertical, 7)
                            .background(.white.opacity(0.92), in: Capsule())
                            .padding(10)
                    }
            } else {
                VStack(spacing: 6) {
                    Image(systemName: "camera").font(.system(size: 22))
                    Text("Add a photo of the dish").font(.inter(15, weight: .medium))
                }
                .foregroundStyle(Color.plum)
                .frame(maxWidth: .infinity)
                .frame(height: 140)
                .background(Color.surface, in: RoundedRectangle(cornerRadius: 18))
                .overlay(
                    RoundedRectangle(cornerRadius: 18)
                        .strokeBorder(Color.dash, style: StrokeStyle(lineWidth: 1.5, dash: [6, 4]))
                )
            }
        }
        .buttonStyle(.plain)
    }

    private var hasPhoto: Bool { draft.newPhoto != nil || draft.image != nil }

    @ViewBuilder
    private var photoPreview: some View {
        if let photo = draft.newPhoto {
            Image(uiImage: photo).resizable().scaledToFill()
        } else {
            RecipeImage(url: Recipe(id: "", title: draft.title, image: draft.image).imageURL, title: draft.title)
        }
    }

    private func loadPhoto(_ item: PhotosPickerItem?) {
        guard let item else { return }
        Task {
            if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
                draft.newPhoto = image
                errorMessage = nil
            } else {
                errorMessage = "We couldn’t read that photo. Try a different one."
            }
            photoItem = nil
        }
    }

    // MARK: Tags

    private var tagEditor: some View {
        FlowLayout(spacing: 8) {
            ForEach(draft.tags, id: \.self) { tag in
                HStack(spacing: 4) {
                    Text(tag.capitalized)
                        .font(.inter(14, weight: .semibold))
                    Button {
                        draft.tags.removeAll { $0 == tag }
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 10, weight: .bold))
                            .frame(width: 24, height: 24)
                    }
                    .accessibilityLabel("Remove tag \(tag)")
                }
                .foregroundStyle(Color.plum)
                .padding(.leading, 14)
                .padding(.trailing, 6)
                .frame(height: 34)
                .background(Color.chip, in: Capsule())
            }
            TextField("+ tag", text: $tagInput)
                .font(.inter(16))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .focused($tagFieldFocused)
                .frame(width: 110, height: 34)
                .onSubmit(addTag)
                .onChange(of: tagInput) { _, value in
                    if value.hasSuffix(",") { addTag() }
                }
                .onChange(of: tagFieldFocused) { _, focused in
                    if !focused { addTag() }
                }
        }
    }

    private func addTag() {
        let tag = RecipeDraft.normalizeTag(tagInput.replacingOccurrences(of: ",", with: ""))
        if !tag.isEmpty && !draft.tags.contains(tag) {
            draft.tags.append(tag)
        }
        tagInput = ""
    }

    // MARK: Ingredient / step rows

    private func rowsBox(rows: Binding<[RecipeDraft.Row]>, placeholder: String, addTitle: String, numbered: Bool) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(rows.wrappedValue.enumerated()), id: \.element.id) { index, row in
                HStack(alignment: .top, spacing: 8) {
                    if numbered {
                        Text("\(index + 1)")
                            .font(.inter(12, weight: .bold))
                            .foregroundStyle(Color.plum)
                            .frame(width: 24, height: 24)
                            .background(Color.chip, in: Circle())
                            .padding(.top, 12)
                    }
                    rowField(rows: rows, row: row, placeholder: placeholder, numbered: numbered)
                    Button {
                        rows.wrappedValue.removeAll { $0.id == row.id }
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Color(hex: 0xC4B0BA))
                            .frame(width: 34, height: 34)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 7)
                    .accessibilityLabel("Remove \(numbered ? "step" : "ingredient") \(index + 1)")
                }
                .padding(.leading, 14)
                .padding(.trailing, 6)
                .frame(minHeight: 48)
                .overlay(alignment: .bottom) { Color.line.frame(height: 1) }
            }
            Button {
                addRow(to: rows)
            } label: {
                Label(addTitle, systemImage: "plus")
                    .font(.inter(15, weight: .semibold))
                    .foregroundStyle(Color.plum)
                    .padding(.horizontal, 14)
                    .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .background(Color.surface, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color.line))
        .clipShape(RoundedRectangle(cornerRadius: 18))
    }

    private func rowField(rows: Binding<[RecipeDraft.Row]>, row: RecipeDraft.Row, placeholder: String, numbered: Bool) -> some View {
        let text = Binding(
            get: { rows.wrappedValue.first { $0.id == row.id }?.text ?? "" },
            set: { value in
                guard let i = rows.wrappedValue.firstIndex(where: { $0.id == row.id }) else { return }
                // Return on an ingredient starts the next one, like the web editor.
                if !numbered && value.contains("\n") {
                    rows.wrappedValue[i].text = value.replacingOccurrences(of: "\n", with: "")
                    addRow(to: rows)
                } else {
                    rows.wrappedValue[i].text = value
                }
            }
        )
        return TextField(placeholder, text: text, axis: .vertical)
            .font(.inter(16))
            .lineSpacing(3)
            .padding(.vertical, 12)
            .submitLabel(numbered ? .return : .next)
            .focused($focusedRow, equals: row.id)
    }

    private func addRow(to rows: Binding<[RecipeDraft.Row]>) {
        let row = RecipeDraft.Row(text: "")
        rows.wrappedValue.append(row)
        focusedRow = row.id
    }

    // MARK: Save / delete

    private func save() {
        addTag()
        guard draft.canSave, !isSaving else { return }
        isSaving = true
        errorMessage = nil
        Task {
            do {
                let saved = try await store.save(draft, auth: auth)
                dismiss()
                onSaved(saved)
            } catch {
                errorMessage = [
                    "The oven door’s stuck, so we couldn’t save that. Try again in a moment.",
                    "That one slid off the plate, so we couldn’t save it. Try again in a moment.",
                ].randomElement()
                isSaving = false
            }
        }
    }

    private func delete() {
        guard let id = draft.id else { return }
        isSaving = true
        Task {
            do {
                try await store.delete(id: id, auth: auth)
                dismiss()
                onDeleted()
            } catch {
                errorMessage = "That one’s stuck to the pan, so we couldn’t delete it. Try again."
                isSaving = false
            }
        }
    }
}

/// Labeled field (`.field` in EditorScreen.css).
private struct EditorField<Content: View>: View {
    let label: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.inter(13, weight: .semibold))
                .foregroundStyle(Color.muted)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, 14)
    }
}

private struct SectionHeading: View {
    let title: String

    var body: some View {
        Text(title.uppercased())
            .font(.inter(12.5, weight: .semibold))
            .tracking(0.9)
            .foregroundStyle(Color.muted)
            .padding(.horizontal, 2)
            .padding(.top, 20)
            .padding(.bottom, 8)
    }
}

/// − value + control (`.stepper` in ui.css).
private struct ServingsStepper: View {
    @Binding var value: Int

    var body: some View {
        HStack {
            stepButton("minus", label: "Fewer servings") { value = max(1, value - 1) }
            Spacer()
            Text("\(value)")
                .font(.inter(17, weight: .semibold))
                .foregroundStyle(Color.text)
                .contentTransition(.numericText())
                .animation(.default, value: value)
            Spacer()
            stepButton("plus", label: "More servings") { value += 1 }
        }
        .padding(.horizontal, 4)
        .frame(height: 48)
        .background(Color.surface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.line))
        .sensoryFeedback(.selection, trigger: value)
    }

    private func stepButton(_ icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Color.plum)
                .frame(width: 40, height: 40)
                .background(Color.chip, in: RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

private extension View {
    /// White rounded input (`.inp` in EditorScreen.css).
    func inputBox() -> some View {
        self
            .foregroundStyle(Color.text)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(minHeight: 48)
            .background(Color.surface, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.line))
    }
}

/// The system camera, for taking a photo of the dish.
struct CameraPicker: UIViewControllerRepresentable {
    static var isAvailable: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }

    let onImage: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker

        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { parent.onImage(image) }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}

#Preview {
    var draft = RecipeDraft()
    draft.title = "Banana Bread"
    draft.tags = ["dessert", "baking"]
    draft.ingredients = [.init(text: "3 ripe bananas"), .init(text: "1/3 cup melted butter")]
    draft.steps = [.init(text: "Preheat the oven to 350°F.")]
    return RecipeEditorView(draft: draft)
        .environment(AuthModel())
        .environment(RecipeStore())
}
