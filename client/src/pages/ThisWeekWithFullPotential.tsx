import FullPotentialMyWeekDock from "@/components/FullPotentialMyWeekDock";
import FullPotentialNextBest5 from "@/components/FullPotentialNextBest5";
import ThisWeek from "./ThisWeek";

export default function ThisWeekWithFullPotential() {
  return (
    <>
      <ThisWeek />
      <FullPotentialNextBest5 />
      <FullPotentialMyWeekDock />
    </>
  );
}
