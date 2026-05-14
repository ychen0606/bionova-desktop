import Editor from "@monaco-editor/react";
import { useRef } from "react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onRun: () => void;
  readOnly?: boolean;
  /// Called when the user presses Cmd/Ctrl+K. Receives the currently selected
  /// text and the full cell text. If selection is empty, both are the full
  /// cell. The host renders InlineAIDialog and, on Apply, calls back into
  /// `replaceSelection` with the new snippet (or full source).
  onCmdK?: (selection: string, surrounding: string) => void;
  /// Ref handle the host can use to push the AI-rewritten snippet back into
  /// the editor; works on whatever range was selected when Cmd+K fired.
  registerReplaceHandle?: (replace: (text: string) => void) => void;
}

export function MonacoCellEditor({
  value,
  onChange,
  onRun,
  readOnly,
  onCmdK,
  registerReplaceHandle,
}: Props) {
  const lineCount = Math.max(3, Math.min(24, value.split("\n").length));
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const lastRangeRef = useRef<any>(null);

  return (
    <div className="border rounded" data-testid="monaco-host">
      <Editor
        height={`${lineCount * 22}px`}
        language="python"
        theme="light"
        value={value}
        onChange={(v) => onChange(v ?? "")}
        onMount={(editor, monaco) => {
          editorRef.current = editor;
          monacoRef.current = monaco;
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, onRun);
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
            if (!onCmdK) return;
            const model = editor.getModel();
            if (!model) return;
            const sel = editor.getSelection();
            const allText = model.getValue();
            let selText = "";
            if (sel && !sel.isEmpty()) {
              selText = model.getValueInRange(sel);
              lastRangeRef.current = sel;
            } else {
              selText = allText;
              lastRangeRef.current = model.getFullModelRange();
            }
            onCmdK(selText, allText);
          });
          registerReplaceHandle?.((text: string) => {
            const ed = editorRef.current;
            const m = monacoRef.current;
            if (!ed || !m) return;
            const range = lastRangeRef.current ?? ed.getModel().getFullModelRange();
            ed.executeEdits("cmd-k", [{ range, text, forceMoveMarkers: true }]);
          });
        }}
        options={{
          minimap: { enabled: false },
          lineNumbers: "on",
          fontSize: 13,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 4,
          insertSpaces: true,
          renderLineHighlight: "all",
          wordWrap: "off",
          readOnly: readOnly ?? false,
        }}
      />
    </div>
  );
}
