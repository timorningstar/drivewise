export default function RepairDateRange({value,onChange}){
 const invalid=value.from&&value.through&&value.from>value.through
 return <fieldset className="repair-date-range"><legend>Date Range</legend><div className="field-grid">
  <label>From<input type="date" value={value.from} max={value.through||undefined} onChange={e=>onChange({...value,from:e.target.value})}/></label>
  <label>Through<input type="date" value={value.through} min={value.from||undefined} onChange={e=>onChange({...value,through:e.target.value})}/></label>
  <button type="button" onClick={()=>onChange({from:'',through:''})}>Clear dates</button>
 </div><small>Filters by repair completion date, including both dates. Older records without a completion timestamp use the recorded repair date. Leave dates blank to show all.</small>{invalid&&<p role="alert" className="error-message">From must be on or before Through.</p>}</fieldset>
}
