import { blankProject } from "@/lib/calc";
import { ensureDefaultProject, loadState } from "../actions";
import { ensureProfile } from "@/lib/roles";
import App from "@/components/App";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { role, userId } = await ensureProfile();

  let roster, projects, bookings;
  try {
    ({ roster, projects, bookings } = await loadState());
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
    const p = blankProject("Project 1", 0);
    await ensureDefaultProject(p);
    projects = [p];
  }

  return <App initialRoster={roster} initialProjects={projects} initialBookings={bookings} role={role} currentUserId={userId} />;
}
