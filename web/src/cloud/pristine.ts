import { emptyProject } from "@/model/defaults";
import type { Project } from "@/model/types";

/** The project's content without the parts a fresh face never shares with another one: ids and names. */
function shape(project: Project): string {
  return JSON.stringify({ ...project, name: "", elements: project.elements.map(({ id: _id, ...rest }) => rest) });
}

/** True while the project is still the face a new session starts with: opening something over it loses nothing. */
export function isPristine(project: Project): boolean {
  return shape(project) === shape(emptyProject(undefined, project.screen));
}
