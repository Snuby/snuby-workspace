import Topbar from "@/components/workbench/topbar";
import HomeAtmosphere from "@/components/workbench/home/home-atmosphere";

export default function HomePage() {
  return (
    <>
      <Topbar title="工作台" />
      <div className="flex-1 overflow-auto">
        <HomeAtmosphere />
      </div>
    </>
  );
}
