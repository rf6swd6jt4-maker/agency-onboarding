-- Separate public agency artwork from the internal workspace avatar.

alter table public.workspaces
    add column if not exists agency_logo_path text,
    add column if not exists agency_favicon_path text;

alter table public.workspaces
    drop constraint if exists workspaces_agency_logo_path_check,
    add constraint workspaces_agency_logo_path_check check (
        agency_logo_path is null
        or agency_logo_path like id::text || '/client-branding/logo/%'
    ),
    drop constraint if exists workspaces_agency_favicon_path_check,
    add constraint workspaces_agency_favicon_path_check check (
        agency_favicon_path is null
        or agency_favicon_path like id::text || '/client-branding/favicon/%'
    );
