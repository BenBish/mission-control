/**
 * Skills Page
 * Skills Registry - list all skills with filtering
 */

import { useSkills } from "./hooks/useSkills";
import { SkillsList } from "./components/SkillsList";
import { PageHeader } from "@/components/_shared/PageHeader";
import { Loading } from "@/components/_shared/Loading";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

export default function SkillsPage() {
  const { skills, categories, isLoading, error } = useSkills();

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Skills Registry"
          description="Browse and search available skills in the system"
        />
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-6">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <div>
              <p className="font-medium text-destructive">Error loading skills</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Skills Registry"
        description="Browse and search available skills in the system"
      />
      
      {isLoading ? (
        <Loading />
      ) : (
        <SkillsList
          skills={skills}
          categories={categories}
          isLoading={isLoading}
        />
      )}
    </div>
  );
}
