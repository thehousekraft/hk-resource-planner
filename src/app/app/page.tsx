import { blankParentProject, blankProject } from "@/lib/calc";
import { ensureDefaultProject, loadState } from "../actions";
import { ensureProfile, getAllowedTabs } from "@/lib/roles";
import App from "@/components/App";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { role, userId } = await ensureProfile();
  const allowedTabs = await getAllowedTabs(role);

  let roster, parentProjects, projects, bookings;
  try {
    ({ roster, parentProjects, projects, bookings } = await loadState());
  } catch (e) {
    return (
      <div className="wrap">
        <div className="loaderr">
          Could not load data from Supabase.
          <br />
          {e instanceof Error ? e.message : String(e)}
          <br />
          <br />
          Check your connection and reload.
        </div>
      </div>
    );
  }

  if (!projects.length) {
    const pp = blankParentProject("Project 1");
    const p = blankProject("General", 0, pp.id);
    await ensureDefaultProject(pp, p);
    parentProjects = [pp];
    projects = [p];
  }

  return (
    <App
      initialRoster={roster}
      initialParentProjects={parentProjects}
      initialProjects={projects}
      initialBookings={bookings}
      role={role}
      currentUserId={userId}
      allowedTabs={allowedTabs}
    />
  );
}
