import {describe,it,expect} from 'vitest';
import {normalizeSocialMetricFields,socialMetricCoverage} from './social-metric-coverage.js';
describe('social metric coverage',()=>{
 it('projects nested note counts without mutating source or confusing collected with shared',()=>{
  const source={note:{liked_count:283,comments_count:46,collected_count:23}};
  expect(normalizeSocialMetricFields(source)).toMatchObject({likes:283,comments:46});
  expect(normalizeSocialMetricFields(source).shares).toBeUndefined();expect(source).not.toHaveProperty('likes');
 });
 it('recognizes real observed zero and partial coverage without treating null/text as zero',()=>{
  const c=socialMetricCoverage([{metrics:{likes:0,comments:null}},{metrics:{likes:12,comments:5}},{metrics:{likes:'1万+'}}]);
  expect(c.available).toEqual(['likes','comments']);expect(c.perField.likes).toMatchObject({presentSamples:2,totalSamples:3,status:'partial'});
  expect(c.perField.comments).toMatchObject({presentSamples:1});expect(c.perField.shares).toMatchObject({status:'missing'});
 });
 it('reports covered Douyin counts even with no aggregate research_metric rows',()=>{
  const c=socialMetricCoverage([{metrics:{likes:618,comments:62,shares:95}},{metrics:{likes:408,comments:25,shares:117}}]);
  expect(c.available).toEqual(['likes','comments','shares']);expect(c.perField.likes).toMatchObject({status:'complete'});
 });
});
