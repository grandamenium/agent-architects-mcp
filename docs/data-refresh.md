# Data Refresh

The MCP server searches an indexed copy of Agent Architects community knowledge.

The indexed corpus can include:

- Classroom lessons.
- Community posts.
- Comments.
- Member profiles.

The refresh is not real time. New Skool content can lag behind the MCP search index.

Raw Skool exports and member data dumps are not committed to this public repo.

Maintainers update the corpus through private ingestion and embedding workflows, then the hosted MCP server reads from the Supabase `aa-knowledge` project.
