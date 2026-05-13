interface OutputProps {
  outputs: any[];
}

export function Outputs({ outputs }: OutputProps) {
  if (!outputs || outputs.length === 0) return null;
  return (
    <div className="mt-2 space-y-1" data-testid="outputs">
      {outputs.map((o, i) => (
        <Output key={i} output={o} />
      ))}
    </div>
  );
}

function Output({ output }: { output: any }) {
  switch (output.output_type) {
    case "stream": {
      const text = Array.isArray(output.text) ? output.text.join("") : output.text;
      return (
        <pre
          className={`text-xs whitespace-pre-wrap p-2 rounded ${
            output.name === "stderr"
              ? "bg-red-50 text-red-900"
              : "bg-slate-100"
          }`}
        >
          {text}
        </pre>
      );
    }
    case "display_data":
    case "execute_result": {
      const data = output.data ?? {};
      if (data["image/png"]) {
        return (
          <img
            src={`data:image/png;base64,${data["image/png"]}`}
            alt="output"
            className="max-w-full"
          />
        );
      }
      if (data["text/html"]) {
        const html = Array.isArray(data["text/html"])
          ? data["text/html"].join("")
          : data["text/html"];
        return (
          <div
            className="text-sm"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      }
      const text = data["text/plain"] ?? "";
      const t = Array.isArray(text) ? text.join("") : text;
      return <pre className="text-xs bg-slate-100 p-2 rounded">{t}</pre>;
    }
    case "error": {
      const tb = (output.traceback ?? []).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
      return (
        <pre className="text-xs bg-red-50 text-red-900 p-2 rounded whitespace-pre-wrap">
          {output.ename}: {output.evalue}
          {"\n"}
          {tb}
        </pre>
      );
    }
    default:
      return null;
  }
}
