import { executeDevelopmentFixtureAction } from "../../modules/development-fixture/action-server";
import { DevelopmentFixtureTool } from "./development-fixture-tool";

export function DevelopmentFixtureMount(): React.ReactElement {
  return <DevelopmentFixtureTool action={executeDevelopmentFixtureAction} />;
}
