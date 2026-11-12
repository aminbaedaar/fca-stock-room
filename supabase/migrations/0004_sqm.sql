-- Job calculator (SQM & wastage): the shared materials list.
-- Each material has its roll widths or sheet size, bleed and panel overlap,
-- and `links` says which stock item it is taken from
-- (roll width in cm, e.g. "127", or "sheet" → item id).

create table public.sqm_materials (
  id         text primary key,
  name       text not null check (length(name) between 1 and 80),
  kind       text not null check (kind in ('roll', 'sheet')),
  widths     text not null default '' check (length(widths) <= 80),
  width      numeric(8, 2) not null default 0 check (width >= 0),
  length     numeric(8, 2) not null default 0 check (length >= 0),
  bleed      numeric(6, 2) not null default 0 check (bleed >= 0),
  overlap    numeric(6, 2) not null default 2 check (overlap >= 0),
  links      jsonb not null default '{}'::jsonb,
  sort       integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.sqm_materials enable row level security;
create policy "team can read sqm materials" on public.sqm_materials for select to authenticated using (public.fca_can('view'));
revoke insert, update, delete on public.sqm_materials from anon, authenticated;
alter publication supabase_realtime add table public.sqm_materials;

-- Managers save the whole list at once (add, edit, remove, re-link).
-- p_materials: [{"id","name","kind","widths","width","length","bleed","overlap","links"}]
create or replace function public.save_sqm_materials(p_materials jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
  v_n integer := 0;
begin
  perform public.fca_require('items');
  if jsonb_typeof(p_materials) <> 'array' or jsonb_array_length(p_materials) = 0 then
    raise exception 'The materials list cannot be empty.';
  end if;
  delete from public.sqm_materials
   where id not in (select x ->> 'id' from jsonb_array_elements(p_materials) x);
  for v in select * from jsonb_array_elements(p_materials) loop
    v_n := v_n + 1;
    insert into public.sqm_materials (id, name, kind, widths, width, length, bleed, overlap, links, sort, updated_at)
    values (
      left(v ->> 'id', 40), public.fca_clean(v ->> 'name', 80), v ->> 'kind',
      public.fca_clean(v ->> 'widths', 80),
      coalesce((v ->> 'width')::numeric, 0), coalesce((v ->> 'length')::numeric, 0),
      coalesce((v ->> 'bleed')::numeric, 0), coalesce((v ->> 'overlap')::numeric, 2),
      coalesce(v -> 'links', '{}'::jsonb), v_n, now()
    )
    on conflict (id) do update set
      name = excluded.name, kind = excluded.kind, widths = excluded.widths, width = excluded.width,
      length = excluded.length, bleed = excluded.bleed, overlap = excluded.overlap,
      links = excluded.links, sort = excluded.sort, updated_at = now();
  end loop;
  return v_n;
end $$;

revoke all on function public.save_sqm_materials(jsonb) from public, anon;
grant execute on function public.save_sqm_materials(jsonb) to authenticated;

-- Starting list: the standalone calculator's materials, with roll widths
-- matched to the rolls First Choice keeps in stock.
insert into public.sqm_materials (id, name, kind, widths, width, length, bleed, overlap, sort) values
  ('m3',  'Glossy Sticker',            'roll',  '152, 127, 107', 152, 0, 3, 2, 1),
  ('m10', 'Matte Sticker',             'roll',  '152, 127, 107', 152, 0, 3, 2, 2),
  ('m11', 'Clear Sticker',             'roll',  '127',           127, 0, 3, 2, 3),
  ('m2',  'One Way Sticker',           'roll',  '152, 127',      152, 0, 3, 2, 4),
  ('m24', 'Frosty Sticker',            'roll',  '152, 127',      152, 0, 3, 2, 5),
  ('m12', 'Reflective Vinyl',          'roll',  '127',           127, 0, 3, 2, 6),
  ('m17', 'Wallpaper',                 'roll',  '127',           127, 0, 3, 2, 7),
  ('m14', 'Backlit Film',              'roll',  '127',           127, 0, 3, 2, 8),
  ('m4',  'Pull-up Material',          'roll',  '95',             95, 0, 0, 2, 9),
  ('m16', 'Canvas',                    'roll',  '152',           152, 0, 5, 2, 10),
  ('m9',  'Glossy Banner',             'roll',  '320',           320, 0, 10, 2, 11),
  ('m1',  'Matte Banner',              'roll',  '320',           320, 0, 10, 2, 12),
  ('m7',  'Backlit Flex Banner',       'roll',  '320',           320, 0, 10, 2, 13),
  ('m8',  'Mesh Banner',               'roll',  '320',           320, 0, 10, 2, 14),
  ('m18', 'Fabric / Textile',          'roll',  '320, 160',      320, 0, 5, 2, 15),
  ('m6',  'Frontlit Flex Banner',      'roll',  '320',           320, 0, 10, 2, 16),
  ('m13', 'Floor Graphic Vinyl',       'roll',  '137',           137, 0, 3, 2, 17),
  ('m15', 'Photo Paper',               'roll',  '127',           127, 0, 0, 2, 18),
  ('m5',  'Foamboard 5 mm',            'sheet', '',              122, 244, 0, 2, 19),
  ('m25', 'Foamboard 15 mm',           'sheet', '',              122, 244, 0, 2, 20),
  ('m26', 'ABS Sheet 1 mm',            'sheet', '',              122, 244, 0, 2, 21),
  ('m21', 'Acrylic Sheet 3 mm',        'sheet', '',              122, 244, 0, 2, 22),
  ('m27', 'Acrylic Sheet 5 mm',        'sheet', '',              122, 244, 0, 2, 23),
  ('m19', 'PVC Forex Board 3 mm',      'sheet', '',              122, 244, 0, 2, 24),
  ('m20', 'PVC Forex Board 5 mm',      'sheet', '',              122, 244, 0, 2, 25),
  ('m22', 'Correx Board',              'sheet', '',              122, 244, 0, 2, 26),
  ('m23', 'Aluminium Composite (ACP)', 'sheet', '',              122, 244, 0, 2, 27)
on conflict (id) do nothing;
