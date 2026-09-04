-- Public agency identity, legal-policy destinations, and metadata for branded client pages.

alter table public.workspaces
    add column if not exists agency_display_name text,
    add column if not exists agency_privacy_policy_url text,
    add column if not exists agency_terms_of_service_url text,
    add column if not exists agency_metadata_title text,
    add column if not exists agency_metadata_description text;

alter table public.workspaces
    drop constraint if exists workspaces_agency_display_name_check,
    add constraint workspaces_agency_display_name_check check (
        agency_display_name is null or (
            agency_display_name = btrim(agency_display_name)
            and char_length(agency_display_name) between 2 and 100
            and agency_display_name !~ '[[:cntrl:]]'
        )
    ),
    drop constraint if exists workspaces_agency_privacy_policy_url_check,
    add constraint workspaces_agency_privacy_policy_url_check check (
        agency_privacy_policy_url is null or (
            agency_privacy_policy_url = btrim(agency_privacy_policy_url)
            and char_length(agency_privacy_policy_url) <= 2000
            and lower(agency_privacy_policy_url) ~ '^https://[^[:space:]]+$'
        )
    ),
    drop constraint if exists workspaces_agency_terms_of_service_url_check,
    add constraint workspaces_agency_terms_of_service_url_check check (
        agency_terms_of_service_url is null or (
            agency_terms_of_service_url = btrim(agency_terms_of_service_url)
            and char_length(agency_terms_of_service_url) <= 2000
            and lower(agency_terms_of_service_url) ~ '^https://[^[:space:]]+$'
        )
    ),
    drop constraint if exists workspaces_agency_metadata_title_check,
    add constraint workspaces_agency_metadata_title_check check (
        agency_metadata_title is null or (
            agency_metadata_title = btrim(agency_metadata_title)
            and char_length(agency_metadata_title) between 2 and 100
            and agency_metadata_title !~ '[[:cntrl:]]'
        )
    ),
    drop constraint if exists workspaces_agency_metadata_description_check,
    add constraint workspaces_agency_metadata_description_check check (
        agency_metadata_description is null or (
            agency_metadata_description = btrim(agency_metadata_description)
            and char_length(agency_metadata_description) between 10 and 300
            and agency_metadata_description !~ '[[:cntrl:]]'
        )
    );
