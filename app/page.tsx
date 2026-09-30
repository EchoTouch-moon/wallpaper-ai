import { OneTouchGateway } from "@/components/landing/OneTouchGateway";
import { OneTouchStudio } from "@/components/studio/OneTouchStudio";

export default function HomePage() {
  return (
    <OneTouchGateway>
      <OneTouchStudio />
    </OneTouchGateway>
  );
}
