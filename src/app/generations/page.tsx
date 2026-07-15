import { useParams } from "react-router-dom";
import { GenerationsList } from "./components/GenerationsList";
import { GenerationDetail } from "./components/GenerationDetail";

export default function GenerationsPage() {
  const { generationId } = useParams<{ generationId?: string }>();
  return generationId ? (
    <GenerationDetail generationId={generationId} />
  ) : (
    <GenerationsList />
  );
}
