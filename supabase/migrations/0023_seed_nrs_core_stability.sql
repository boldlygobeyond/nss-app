-- Seeds all 7 NRS clusters (only Core Stability has questions yet — the
-- other 6 stay unconfigured) and the 10 Core Stability scenarios, text
-- copied verbatim from the approved spec.

insert into public.nrs_clusters (cluster_key, name, description, configured) values
  ('Stability', 'Core Stability', 'The needs that help us feel grounded, secure, and able to navigate our environment with confidence.', true),
  ('Belonging', 'Belonging & Identity', 'Not yet configured.', false),
  ('Recognition', 'Recognition & Value', 'Not yet configured.', false),
  ('Agency', 'Agency & Growth', 'Not yet configured.', false),
  ('Purpose', 'Purpose & Alignment', 'Not yet configured.', false),
  ('Ecosystem', 'Emotional Ecosystem', 'Not yet configured.', false),
  ('Connections', 'Energizing Connections', 'Not yet configured.', false);

insert into public.nrs_questions (id, cluster_key, display_order, need_label, scenario_text) values
  (1, 'Stability', 1, 'Safety', 'You disagree with a teammate''s suggestion in a brainstorming session. They welcome your input, and no one takes it personally.'),
  (2, 'Stability', 2, 'Financial Security', 'You hear that your role is secure even during company-wide budget tightening or layoffs.'),
  (3, 'Stability', 3, 'Predictability', 'You know what to expect from your day before it starts—no surprise meetings or last-minute assignments.'),
  (4, 'Stability', 4, 'Consistency', 'Expectations from leadership are clear and don''t change week to week without explanation.'),
  (5, 'Stability', 5, 'Autonomy', 'Your manager gives you clear goals but trusts you to figure out how to get there. You set your own schedule and aren''t micromanaged.'),
  (6, 'Stability', 6, 'Rest and Recovery', 'It''s the norm to log off at 5 p.m., and no one sends messages after hours. Time off is respected, and people actively encourage each other to unplug.'),
  (7, 'Stability', 7, 'Mental Clarity', 'You have time each day to think deeply or work without interruptions, even when things are busy.'),
  (8, 'Stability', 8, 'Time Sufficiency', 'You''re not pressured to multitask constantly just to keep up.'),
  (9, 'Stability', 9, 'Freedom from Chaos', 'When problems arise, there''s a process to handle them without panic or disarray.'),
  (10, 'Stability', 10, 'Stability of Environment', 'The company has a clear mission, steady leadership, and isn''t constantly restructuring or pivoting.');
