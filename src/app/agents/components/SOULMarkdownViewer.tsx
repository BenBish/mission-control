import ReactMarkdown from "react-markdown";
// @ts-ignore
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
// @ts-ignore
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";

interface SOULMarkdownViewerProps {
  markdown: string;
}

export function SOULMarkdownViewer({ markdown }: SOULMarkdownViewerProps) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props) {
            const { children, className } = props;
            
            // Check if this is a code block (has language class) or inline code
            // Code blocks have className like "language-xyz", inline code does not
            const match = /language-(\w+)/.exec(className || "");
            const isCodeBlock = Boolean(match);
            
            // If it's inline code, use simple styling
            if (!isCodeBlock) {
              return (
                <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono text-foreground">
                  {children}
                </code>
              );
            }

            // Otherwise, it's a code block - use syntax highlighter
            const language = match ? match[1] : "text";
            return (
              <SyntaxHighlighter
                language={language}
                style={oneDark}
                className="rounded-lg overflow-x-auto"
                PreTag="div"
              >
                {String(children).replace(/\n$/, "")}
              </SyntaxHighlighter>
            );
          },
          // Style headings
          h1(props) {
            return (
              <h1 className="text-3xl font-bold mt-8 mb-4 scroll-m-20">
                {props.children}
              </h1>
            );
          },
          h2(props) {
            return (
              <h2 className="text-2xl font-bold mt-6 mb-3 scroll-m-20 border-b pb-2">
                {props.children}
              </h2>
            );
          },
          h3(props) {
            return (
              <h3 className="text-xl font-semibold mt-5 mb-2 scroll-m-20">
                {props.children}
              </h3>
            );
          },
          // Style lists
          ul(props) {
            return (
              <ul className="list-disc list-inside space-y-1 my-3">
                {props.children}
              </ul>
            );
          },
          ol(props) {
            return (
              <ol className="list-decimal list-inside space-y-1 my-3">
                {props.children}
              </ol>
            );
          },
          // Style paragraphs
          p(props) {
            return <p className="my-3 leading-7">{props.children}</p>;
          },
          // Style blockquotes
          blockquote(props) {
            return (
              <blockquote className="border-l-4 border-primary pl-4 italic my-3 text-muted-foreground">
                {props.children}
              </blockquote>
            );
          },
          // Style tables
          table(props) {
            return (
              <table className="border-collapse border border-border w-full my-3">
                {props.children}
              </table>
            );
          },
          th(props) {
            return (
              <th className="border border-border bg-muted p-2 font-semibold">
                {props.children}
              </th>
            );
          },
          td(props) {
            return (
              <td className="border border-border p-2">{props.children}</td>
            );
          },
          // Style links
          a(props) {
            return (
              <a
                href={props.href}
                className="text-primary hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                {props.children}
              </a>
            );
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
