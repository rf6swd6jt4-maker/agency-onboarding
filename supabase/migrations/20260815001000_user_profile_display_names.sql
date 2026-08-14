alter table public.user_profiles
    add column if not exists display_name text;

update public.user_profiles
set display_name = username
where display_name is null or btrim(display_name) = '';

create or replace function public.normalise_user_profile_display_name()
returns trigger
language plpgsql
set search_path = public
as $$
declare
    normalised_name text;
begin
    normalised_name := btrim(regexp_replace(coalesce(new.display_name, ''), '[[:space:]]+', ' ', 'g'));
    if normalised_name = '' or char_length(normalised_name) > 50 then
        normalised_name := new.username;
    end if;
    new.display_name := normalised_name;
    return new;
end;
$$;

drop trigger if exists normalise_user_profile_display_name on public.user_profiles;
create trigger normalise_user_profile_display_name
before insert or update of username, display_name on public.user_profiles
for each row execute function public.normalise_user_profile_display_name();

alter table public.user_profiles
    alter column display_name set not null;

alter table public.user_profiles
    drop constraint if exists user_profiles_display_name_check;
alter table public.user_profiles
    add constraint user_profiles_display_name_check
    check (
        display_name = btrim(display_name)
        and char_length(display_name) between 1 and 50
        and display_name !~ '[[:cntrl:]]'
    );
