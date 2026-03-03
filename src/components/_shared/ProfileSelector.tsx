import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProfile } from "@/app/profile-context";

export function ProfileSelector() {
  const { profiles, activeProfile, setActiveProfile, isLoadingProfiles } =
    useProfile();

  if (isLoadingProfiles || profiles.length === 0) {
    return <div className="h-9 w-40 animate-pulse rounded-md bg-muted" />;
  }

  const handleValueChange = (profileId: string) => {
    const profile = profiles.find((p) => p.id === profileId);
    if (profile) {
      setActiveProfile(profile);
    }
  };

  return (
    <Select value={activeProfile?.id ?? ""} onValueChange={handleValueChange}>
      <SelectTrigger className="h-9 w-44 gap-2 text-sm">
        <SelectValue placeholder="Select profile">
          {activeProfile && (
            <span className="flex items-center gap-2">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  activeProfile.status === "online"
                    ? "bg-green-500"
                    : "bg-red-500"
                }`}
              />
              <span className="truncate">{activeProfile.name}</span>
            </span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {profiles.map((profile) => (
          <SelectItem key={profile.id} value={profile.id}>
            <span className="flex items-center gap-2">
              <span
                className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${
                  profile.status === "online" ? "bg-green-500" : "bg-red-500"
                }`}
              />
              <span className="truncate">{profile.name}</span>
              <span className="text-xs text-muted-foreground ml-1">
                ({profile.agentCount ?? 0})
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
