-- Function to merge duplicate contacts by normalized phone number
-- Keeps the record with the most data (name, highest counts, earliest first_seen, latest last_seen)
CREATE OR REPLACE FUNCTION public.merge_duplicate_contacts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  merged_count integer := 0;
  dup_record record;
  keeper_id uuid;
  combined_name text;
  combined_notes text;
  combined_sms integer;
  combined_calls integer;
  combined_first timestamp with time zone;
  combined_last timestamp with time zone;
  combined_source text;
BEGIN
  -- Find groups of contacts with duplicate phone numbers (after normalizing)
  FOR dup_record IN
    SELECT 
      regexp_replace(phone_number, '[\s\-\(\)\.]', '', 'g') AS normalized_phone,
      array_agg(id ORDER BY 
        (CASE WHEN name IS NOT NULL AND name != '' THEN 0 ELSE 1 END),
        sms_count + call_count DESC,
        created_at ASC
      ) AS ids,
      count(*) AS cnt
    FROM public.contacts
    GROUP BY regexp_replace(phone_number, '[\s\-\(\)\.]', '', 'g')
    HAVING count(*) > 1
  LOOP
    -- The first id is the "keeper" (has name, most activity, oldest)
    keeper_id := dup_record.ids[1];
    
    -- Aggregate all data from duplicates
    SELECT 
      COALESCE(
        (SELECT name FROM contacts WHERE id = ANY(dup_record.ids) AND name IS NOT NULL AND name != '' LIMIT 1),
        NULL
      ),
      string_agg(DISTINCT notes, '; ' ORDER BY notes) FILTER (WHERE notes IS NOT NULL AND notes != ''),
      COALESCE(SUM(sms_count), 0),
      COALESCE(SUM(call_count), 0),
      MIN(first_seen_at),
      MAX(last_seen_at),
      (SELECT source FROM contacts WHERE id = keeper_id)
    INTO combined_name, combined_notes, combined_sms, combined_calls, combined_first, combined_last, combined_source
    FROM contacts
    WHERE id = ANY(dup_record.ids);
    
    -- Update the keeper with merged data
    UPDATE contacts SET
      name = combined_name,
      notes = combined_notes,
      sms_count = combined_sms,
      call_count = combined_calls,
      first_seen_at = combined_first,
      last_seen_at = combined_last,
      phone_number = dup_record.normalized_phone,
      updated_at = now()
    WHERE id = keeper_id;
    
    -- Delete the duplicates (all except keeper)
    DELETE FROM contacts 
    WHERE id = ANY(dup_record.ids) AND id != keeper_id;
    
    merged_count := merged_count + (array_length(dup_record.ids, 1) - 1);
  END LOOP;
  
  RETURN jsonb_build_object('merged', merged_count);
END;
$$;