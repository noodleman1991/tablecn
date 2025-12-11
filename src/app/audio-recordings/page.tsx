import { requireAudioRecordingAuth } from "@/lib/audio-recording-auth";
import { AuthorizationForm } from "./components/authorization-form";
import { LogoutButton } from "./components/logout-button";

export default async function AudioRecordingsPage() {
  const authorizedEmail = await requireAudioRecordingAuth();

  // Show authorization form if not authenticated
  if (!authorizedEmail) {
    return <AuthorizationForm />;
  }

  // Show authorized content
  return (
    <div className="container py-8">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold mb-1">Welcome</h2>
            <p className="text-muted-foreground">{authorizedEmail}</p>
          </div>
          <LogoutButton />
        </div>

        <div className="rounded-lg border bg-card p-6">
          <p className="text-muted-foreground text-center">
            Audio recordings content will appear here
          </p>
        </div>
      </div>
    </div>
  );
}
