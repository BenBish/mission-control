import { useParams, useNavigate } from "react-router-dom";
import { useSkills } from "../hooks/useSkills";
import { useProfile } from "@/app/profile-context";
import { PageHeader } from "@/components/_shared/PageHeader";
import { Loading } from "@/components/_shared/Loading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, ArrowLeft, Wrench } from "lucide-react";

export default function SkillDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeProfile, isSwitching } = useProfile();
  const { skills, isLoading, error } = useSkills(activeProfile?.id);

  if (!id) {
    return (
      <div className="space-y-6">
        <PageHeader title="Skill" description="Skill details" />
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-6">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <p className="font-medium text-destructive">Invalid skill ID</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || isSwitching) {
    return (
      <div className="space-y-6">
        <PageHeader title="Skill" description="Loading skill details..." />
        <Loading />
      </div>
    );
  }

  const skill = skills.find((s) => s.id === id);

  if (error || !skill) {
    return (
      <div className="space-y-6">
        <PageHeader title="Skill" description="Skill details" />
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-6">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <div>
              <p className="font-medium text-destructive">
                Error loading skill
              </p>
              <p className="text-sm text-muted-foreground">
                {error || "Skill not found"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          onClick={() => navigate("/skills")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Skills
        </Button>
      </div>

      {/* Skill Header */}
      <Card>
        <CardHeader>
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 dark:bg-primary/20">
              <Wrench className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-2xl">{skill.name}</CardTitle>
              {skill.category && (
                <div className="mt-2">
                  <Badge variant="secondary">{skill.category}</Badge>
                </div>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{skill.description}</p>
        </CardContent>
      </Card>
    </div>
  );
}
