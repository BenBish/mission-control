/**
 * Permissions Page
 * Displays the Agent × Skill permissions matrix visualization.
 */

import { usePermissionsMatrix } from "./hooks/usePermissionsMatrix";
import { PermissionsMatrix } from "./components/PermissionsMatrix";
import { PageHeader } from "@/components/_shared/PageHeader";
import { Loading } from "@/components/_shared/Loading";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

export default function PermissionsPage() {
  const { data, isLoading, error } = usePermissionsMatrix();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Permissions Matrix"
          description="Visual overview of agent skill access across the system"
        />
        <Loading />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Permissions Matrix"
          description="Visual overview of agent skill access across the system"
        />
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-6">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <div>
              <p className="font-medium text-destructive">
                Error loading permissions matrix
              </p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data || data.agents.length === 0 || data.skills.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Permissions Matrix"
          description="Visual overview of agent skill access across the system"
        />
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              {!data || (data.agents.length === 0 && data.skills.length === 0)
                ? "No agents or skills found. Configure agents and skills to see the permissions matrix."
                : data.agents.length === 0
                  ? "No agents found."
                  : "No skills configured."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Permissions Matrix"
        description="Visual overview of agent skill access across the system"
      />
      <PermissionsMatrix data={data} />
    </div>
  );
}
