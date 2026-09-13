-- Apply with the Supabase CLI or SQL editor. No real locations are seeded.
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.profiles(id uuid primary key references auth.users on delete cascade, display_name text not null default 'Walker' check(length(display_name) between 1 and 80));
create table public.families(id uuid primary key default gen_random_uuid(),name text not null check(length(name) between 1 and 80),created_by uuid not null references auth.users);
create table public.family_members(family_id uuid not null references public.families on delete cascade,user_id uuid not null unique references auth.users on delete cascade,role text not null check(role in ('guardian','member')),can_share boolean not null default false,primary key(family_id,user_id));
create table public.family_invites(id uuid primary key default gen_random_uuid(),family_id uuid not null references public.families on delete cascade,email text not null,token_hash text not null unique,expires_at timestamptz not null default now()+interval '48 hours',accepted_at timestamptz);
create table public.saved_locations(id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users on delete cascade,label text not null check(length(label) between 1 and 80),longitude double precision not null check(longitude between -180 and 180),latitude double precision not null check(latitude between -90 and 90),location extensions.geography(Point,4326) generated always as (extensions.st_setsrid(extensions.st_makepoint(longitude,latitude),4326)::extensions.geography) stored,visibility text not null check(visibility in ('private','family')),family_id uuid references public.families on delete cascade,check((visibility='private' and family_id is null) or (visibility='family' and family_id is not null)));
create index saved_locations_geo on public.saved_locations using gist(location);
create table public.saved_routes(id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users on delete cascade,family_id uuid references public.families on delete cascade,label text not null check(length(label) between 1 and 200),route jsonb not null check(jsonb_typeof(route)='object'));
create function public.valid_weights(w jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare k text; begin
 if w is null or jsonb_typeof(w)<>'object' then return false; end if;
 if (select count(*) from jsonb_object_keys(w))<>6 then return false; end if;
 foreach k in array array['crashes','highInjury','sidewalk','crossings','speed','infrastructure'] loop
  if not(w ? k) or jsonb_typeof(w->k)<>'number' then return false; end if;
  if (w->>k)::numeric<0 or (w->>k)::numeric>10 then return false; end if;
 end loop; return true; end $$;
create table public.risk_preferences(family_id uuid primary key references public.families on delete cascade,weights jsonb not null check(public.valid_weights(weights)),updated_by uuid not null references auth.users);
create table public.trips(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users on delete cascade,family_id uuid references public.families on delete cascade,destination_label text not null check(length(destination_label) between 1 and 100),expected_arrival timestamptz not null,expires_at timestamptz not null default now()+interval '2 hours',status text not null default 'active' check(status in ('active','arrived','cancelled')),created_at timestamptz not null default now());
create table public.trip_grants(trip_id uuid not null references public.trips on delete cascade,viewer_id uuid not null references auth.users on delete cascade,primary key(trip_id,viewer_id));
-- Graph storage is separate from private family data. Ingestion must validate pedestrian access.
create table public.street_nodes(id bigint primary key,location extensions.geography(Point,4326) not null);
create table public.street_edges(id bigint primary key,from_node bigint not null references public.street_nodes,to_node bigint not null references public.street_nodes,geometry extensions.geometry(LineString,4326) not null,meters double precision not null check(meters>0),features jsonb not null,source text not null,observed_at date not null,missing_factors text[] not null default '{}');
create index street_edges_geo on public.street_edges using gist(geometry);

create function public.is_family_member(f uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.family_members where family_id=f and user_id=auth.uid())$$;
create function public.is_guardian(f uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.family_members where family_id=f and user_id=auth.uid() and role='guardian')$$;
create function public.can_share_trip(f uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.family_members where family_id=f and user_id=auth.uid() and can_share)$$;
create function public.can_view_trip(t uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.trips tr join public.trip_grants g on g.trip_id=tr.id join public.family_members m on m.family_id=tr.family_id and m.user_id=g.viewer_id where tr.id=t and g.viewer_id=auth.uid() and tr.status='active' and tr.expires_at>now())$$;

do $$declare t text;begin foreach t in array array['profiles','families','family_members','family_invites','saved_locations','saved_routes','risk_preferences','trips','trip_grants','street_nodes','street_edges'] loop execute format('alter table public.%I enable row level security',t);end loop;end$$;
create policy profile_read on public.profiles for select to authenticated using(id=auth.uid());
create policy profile_edit on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy family_read on public.families for select to authenticated using(public.is_family_member(id));
create policy member_read on public.family_members for select to authenticated using(public.is_family_member(family_id));
create policy location_read on public.saved_locations for select to authenticated using(owner_id=auth.uid() or (visibility='family' and public.is_family_member(family_id)));
create policy location_add on public.saved_locations for insert to authenticated with check(owner_id=auth.uid() and (family_id is null or public.is_guardian(family_id)));
create policy location_edit on public.saved_locations for update to authenticated using((family_id is null and owner_id=auth.uid()) or public.is_guardian(family_id)) with check((family_id is null and owner_id=auth.uid()) or public.is_guardian(family_id));
create policy location_remove on public.saved_locations for delete to authenticated using((family_id is null and owner_id=auth.uid()) or public.is_guardian(family_id));
create policy route_read on public.saved_routes for select to authenticated using(owner_id=auth.uid() or public.is_family_member(family_id));
create policy route_add on public.saved_routes for insert to authenticated with check(owner_id=auth.uid() and (family_id is null or public.is_guardian(family_id)));
create policy route_remove on public.saved_routes for delete to authenticated using((family_id is null and owner_id=auth.uid()) or public.is_guardian(family_id));
create policy preference_read on public.risk_preferences for select to authenticated using(public.is_family_member(family_id));
create policy preference_add on public.risk_preferences for insert to authenticated with check(public.is_guardian(family_id) and updated_by=auth.uid());
create policy preference_edit on public.risk_preferences for update to authenticated using(public.is_guardian(family_id)) with check(public.is_guardian(family_id) and updated_by=auth.uid());
create policy trip_read on public.trips for select to authenticated using(user_id=auth.uid() or public.can_view_trip(id));
create policy trip_add on public.trips for insert to authenticated with check(user_id=auth.uid() and status='active' and created_at between now()-interval '1 minute' and now()+interval '1 minute' and expires_at>now() and expires_at<=now()+interval '2 hours 1 minute' and (family_id is null or public.can_share_trip(family_id)));
create policy grant_read on public.trip_grants for select to authenticated using(viewer_id=auth.uid() or exists(select 1 from public.trips where id=trip_id and user_id=auth.uid()));
create policy grant_add on public.trip_grants for insert to authenticated with check(exists(select 1 from public.trips t join public.family_members m on m.family_id=t.family_id and m.user_id=viewer_id where t.id=trip_id and t.user_id=auth.uid() and t.status='active' and t.expires_at>now() and viewer_id<>auth.uid() and public.can_share_trip(t.family_id)));

create function public.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$begin insert into public.profiles(id,display_name) values(new.id,left(coalesce(nullif(new.raw_user_meta_data->>'display_name',''),'Walker'),80));return new;end$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
create function public.create_family(p_name text) returns uuid language plpgsql security definer set search_path='' as $$declare f uuid;begin
 if auth.uid() is null then raise exception 'Sign in first';end if;
 if exists(select 1 from public.family_members where user_id=auth.uid()) then raise exception 'Already in a family';end if;
 insert into public.families(name,created_by) values(trim(p_name),auth.uid()) returning id into f;
 insert into public.family_members values(f,auth.uid(),'guardian',true);return f;end$$;
create function public.create_family_invite(p_family uuid,p_email text) returns text language plpgsql security definer set search_path='' as $$declare token text;begin
 if not public.is_guardian(p_family) then raise exception 'Guardian access required';end if;
 if length(p_email)>254 or p_email not like '%@%.%' then raise exception 'Valid email required';end if;
 token=encode(extensions.gen_random_bytes(24),'hex');
 insert into public.family_invites(family_id,email,token_hash) values(p_family,lower(trim(p_email)),encode(extensions.digest(token,'sha256'),'hex'));return token;end$$;
create function public.accept_family_invite(p_token text) returns uuid language plpgsql security definer set search_path='' as $$declare inv public.family_invites;verified_email text;begin
 select lower(email) into verified_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if verified_email is null then raise exception 'Sign in with a verified email';end if;
 select * into inv from public.family_invites where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and email=verified_email and expires_at>now() and accepted_at is null for update;
 if inv.id is null then raise exception 'Invitation invalid, expired, or intended for a different account';end if;
 insert into public.family_members values(inv.family_id,auth.uid(),'member',false);
 update public.family_invites set accepted_at=now() where id=inv.id;return inv.family_id;end$$;
create function public.set_sharing_permission(p_family uuid,p_member uuid,p_allowed boolean) returns void language plpgsql security definer set search_path='' as $$begin
 if not public.is_guardian(p_family) then raise exception 'Guardian access required';end if;
 update public.family_members set can_share=p_allowed where family_id=p_family and user_id=p_member;
 if not p_allowed then delete from public.trip_grants where trip_id in(select id from public.trips where family_id=p_family and user_id=p_member);end if;end$$;
create function public.end_trip(p_trip uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$begin
 if p_status not in ('arrived','cancelled') then raise exception 'Invalid trip status';end if;
 update public.trips set status=p_status where id=p_trip and user_id=auth.uid();if not found then raise exception 'Trip unavailable';end if;
 delete from public.trip_grants where trip_id=p_trip;end$$;

-- No anonymous data or RPC access. Members cannot self-promote or change permissions.
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from public,anon;
grant usage on schema public to authenticated;
grant select,insert,update,delete on public.profiles,public.families,public.family_members,public.family_invites,public.saved_locations,public.saved_routes,public.risk_preferences,public.trips,public.trip_grants to authenticated;
grant execute on function public.valid_weights(jsonb), public.is_family_member(uuid),public.is_guardian(uuid),public.can_share_trip(uuid),public.can_view_trip(uuid),public.create_family(text),public.create_family_invite(uuid,text),public.accept_family_invite(text),public.set_sharing_permission(uuid,uuid,boolean),public.end_trip(uuid,text) to authenticated;
