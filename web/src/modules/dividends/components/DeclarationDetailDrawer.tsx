        <Kv label="Status">{declarationStatusPill(record.status)}</Kv>
        <Kv label="Financial year">
          {record.fy_start} → {record.fy_end}
        </Kv>
        <Kv label="Declared by">
          {/* Declarer attribution (issue #31 ledger (a).4): the
              SERVER's bare staff UUID, short-id convention — least
              disclosure: no name/email is ever fetched for it. NULL
              renders the honest unattributed affordance: an actor is
              never invented. */}
          {record.requested_by !== null ? (
            <span className={styles.mono} title={record.requested_by}>
              {record.requested_by.slice(0, 8)}
            </span>
          ) : (
            "— (unattributed)"
          )}
        </Kv>
        <Kv label="Declared">{fmtDateTime(record.created_at)}</Kv>