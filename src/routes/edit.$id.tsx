import { createFileRoute } from "@tanstack/react-router";
import { RequireUser } from "@/components/platform/frame";
import { DownloadBar } from "@/components/platform/downloads";
import { EditorView } from "@/components/studio/editor-view";

export const Route = createFileRoute("/edit/$id")({
  component: EditorRoute,
});

function EditorRoute() {
  const { id } = Route.useParams();
  return (
    <RequireUser>
      <div className="flex h-dvh flex-col">
        <div className="min-h-0 flex-1">
          <EditorView projectId={id} />
        </div>
        <DownloadBar />
      </div>
    </RequireUser>
  );
}
