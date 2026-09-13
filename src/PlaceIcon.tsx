import {
  GraduationCap,
  TrainFront,
  Trees,
  Star,
  House,
  MapPin,
  Library,
  Dumbbell,
  Store,
} from "lucide-react";
export default function PlaceIcon({
  kind,
  size = 20,
}: {
  kind: string;
  size?: number;
}) {
  const Icon =
    kind === "School"
      ? GraduationCap
      : kind === "Transit"
        ? TrainFront
        : kind === "Park"
          ? Trees
          : kind === "Saved"
            ? Star
            : kind === "Home"
              ? House
              : kind === "Library"
                ? Library
                : kind === "Sports"
                  ? Dumbbell
                  : kind === "Business"
                    ? Store
                    : MapPin;
  return <Icon size={size} aria-hidden="true" />;
}
