/**
 * A structured-data script tag.
 *
 * `JSON.stringify` does not escape `<`, so a string that reached this from
 * anywhere but our own repository could close the script element and run. The
 * data here is all build-time — package manifests and markdown headings — but
 * the escape costs one replace and removes the question entirely.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
