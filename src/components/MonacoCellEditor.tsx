import Editor from "@monaco-editor/react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onRun: () => void;
  readOnly?: boolean;
}

export function MonacoCellEditor({ value, onChange, onRun, readOnly }: Props) {
  const lineCount = Math.max(3, Math.min(24, value.split("\n").length));
  return (
    <div className="border rounded" data-testid="monaco-host">
      <Editor
        height={`${lineCount * 22}px`}
        language="python"
        theme="light"
        value={value}
        onChange={(v) => onChange(v ?? "")}
        onMount={(editor, monaco) => {
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, onRun);
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
