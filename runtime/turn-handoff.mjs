import {assertRun,runFor} from './profile-store.mjs';

// A quoted/negated label in a report is not a completion request. The bound
// task protocol requires the promise to be the final standalone line.
export function isFinalCompletionPromise(output) {
  return /(?:^|\n)[\t ]*<promise>[\t ]*LOOP_DONE[\t ]*<\/promise>[\t ]*$/u.test(String(output).trimEnd());
}

/** Let the native Goal driver own active-task continuation at real quiescence. */
export function handoffTaskLoop(agent,message,iteration) {
  const run=runFor(agent.session);
  if(!run)return false; // Standalone upstream PUA keeps its existing driver.
  assertRun(run);
  if(run.agent!==agent)throw Error('handoff_agent_mismatch');
  if(!Number.isInteger(iteration)||iteration<2)throw Error('handoff_iteration_invalid');
  const turns=[...agent.session.ownEvents()].filter(e=>e.type==='turn/start').length;
  // Retain the existing conservative accounting: PUA iteration plus extra
  // physical turns. Refuse the prospective turn before queueing any work.
  const nextRounds=iteration+turns;
  if(!run.budget?.check(nextRounds))return true;
  const goal=run.readGoal?.();
  if(!goal||goal.id!==run.goalId||goal.objective!==run.p.goal.objective||goal.maxGoalRounds!==run.p.goal.maxRounds)
    throw Error('handoff_goal_mismatch');
  const detail={iteration,fromPhysicalTurn:turns,nextRounds,deadline:run.deadline,goal:{id:goal.id,revision:goal.revision,phase:goal.phase}};
  if(goal.phase==='active'&&goal.activation==='armed') {
    // No steer, followup, timer or fabricated Goal-source message here. On
    // turn/end + idle the host reserves and admits its own Goal round.
    run.log('physical_turn_handoff',{...detail,driver:'native_goal'});
    return true;
  }
  if(goal.phase==='complete') {
    // A model may finish Goal before its final re-signing. A completed Goal
    // cannot be rearmed; queue certificate repair as a genuine next turn.
    const pending=run.certificateHandoff;
    if(pending?.turn===turns&&agent.inbox?.nextTurn?.some(m=>m.id===pending.messageId))return true;
    agent.followup(message);
    run.certificateHandoff={turn:turns,messageId:message.id};
    run.log('physical_turn_handoff',{...detail,driver:'certificate_followup'});
    return true;
  }
  throw Error('handoff_goal_not_armed');
}
