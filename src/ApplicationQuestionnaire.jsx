import {useState} from 'react'
export const applicationIntroduction='Reliable transportation is essential for getting to school, work, and other important responsibilities. Vehicle repair assistance through DriveWise is available only to current DTM program participants or individuals referred to us by a partner agency. Through this program, we coordinate the vehicle repairs by ordering the necessary parts and covering all labor costs. Participants are responsible only for the cost of the parts. This application helps us better understand your vehicle repair needs so we can review your request for assistance. Please complete the form honestly and provide as much detail as possible.'
function Required(){return <span className="application-required"> (required)</span>}
function Text({name,label,required=false,multiline=false,hint,...props}){return <label className="application-field"><span>{label}{required&&<Required/>}</span>{hint&&<small>{hint}</small>}{multiline?<textarea name={name} required={required} rows={3} {...props}/>:<input name={name} required={required} {...props}/>}</label>}
function YesNo({name,label,value,onChange}){return <fieldset className="application-choice"><legend>{label}<Required/></legend><div>{['yes','no'].map(option=><label key={option}><input type="radio" name={name} value={option} required {...(value!==undefined?{checked:value===option}:{})} onChange={onChange?e=>onChange(e.target.value):undefined}/><span>{option==='yes'?'Yes':'No'}</span></label>)}</div></fieldset>}
export default function ApplicationQuestionnaire(){
 const[participant,setParticipant]=useState('')
 return <>
 <input type="hidden" name="formVersion" value="2"/>
 <p className="application-introduction">{applicationIntroduction}</p>
 <section className="application-section" aria-label="Contact information">
 <fieldset className="application-name"><legend>Name<Required/></legend><div className="application-name-grid"><Text name="firstName" label="First name" required maxLength={74} autoComplete="given-name"/><Text name="lastName" label="Last name" required maxLength={75} autoComplete="family-name"/></div></fieldset>
 <Text name="phone" label="Phone" type="tel" required maxLength={50} autoComplete="tel"/>
 <Text name="email" label="Email" type="email" maxLength={254} autoComplete="email"/>
 <YesNo name="participant" label="Are you a DTM program participant?" value={participant} onChange={setParticipant}/>
 {participant==='yes'&&<Text name="classAttendance" label="Which DTM program or class are you attending?" required multiline maxLength={2000}/>}
 <Text name="referringAgency" label="If not a participant, what agency referred you?" required={participant==='no'} multiline maxLength={500}/>
 <Text name="referralPhone" label="Referral phone number (if applicable)" type="tel" maxLength={100}/>
 <Text name="referralEmail" label="Referral email (if applicable)" type="email" maxLength={254}/>
 <Text name="bestContactTime" label="Best time to contact you" maxLength={300}/>
 </section>
 <section className="application-section" aria-labelledby="application-vehicle"><h2 id="application-vehicle">Vehicle information</h2>
 <fieldset className="application-name"><legend>Vehicle year, make and model<Required/></legend><div className="application-vehicle-grid"><Text name="year" label="Year" required inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="2009"/><Text name="make" label="Make" required maxLength={100} placeholder="Ford"/><Text name="model" label="Model" required maxLength={100} placeholder="Fiesta"/></div></fieldset>
 <Text name="mileage" label="Mileage on vehicle" type="number" min="0" max="99999999" step="1" inputMode="numeric" required/>
 <Text name="vin" label="VIN #" maxLength={30} required autoCapitalize="characters" autoCorrect="off" spellCheck={false}/>
 <YesNo name="driversLicense" label="Do you have a valid driver's license?"/>
 <YesNo name="registered" label="Is the vehicle currently registered?"/>
 <YesNo name="insured" label="Is the vehicle currently insured?"/>
 <Text name="vehicleLocation" label="Current location of vehicle" required maxLength={500}/>
 <YesNo name="mechanicDiagnosis" label="Has the vehicle been diagnosed by a mechanic?"/>
 <Text name="neededRepairs" label="What repairs need to be done on the vehicle?" hint="Please describe the issues you’re experiencing." required multiline maxLength={6000}/>
 <Text name="recentRepairs" label="Any recent major repairs or accidents?" hint="If so, include when they occurred." multiline maxLength={1500}/>
 </section>
 <section className="application-section" aria-labelledby="application-financial"><h2 id="application-financial">Financial &amp; support</h2>
 <YesNo name="primaryTransportation" label="Is this your primary form of transportation?"/>
 <Text name="dailyLife" label="How is this vehicle beneficial to you in your daily life?" multiline maxLength={1500}/>
 </section>
 </>
}
