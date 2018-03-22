# sensortag_report
## description
Collect data from sensortag sensors :

 * ambient temperature
 * light
 * 3d acceleration
 * pressure
 * humidity
 
 You can putit anywhere in your house and use it for house thermostat. Placed outdoor it will give you weather info in real time.
 
 1 to N sensortags can be connected depending on your bluetooth adapter. When a sensortag is added it is automatically added.

These data are saved locally in an influxdb and displayed with grafana.

## prerequisities
 * bluetooth LE supported

## start reporter 

    sudo DB=your_db DB_USER=your_user_id DB_PASS=your_pass DEBUG=sensortag_report node ./sensortag_report.js
    
## Grafana install 
 * http://docs.grafana.org/installation/*
 
Here is dashboard dispalying sensortag data : 
TODO insert image
 
To generate dashboard for a newly added sensortag : 

    ./grafana/create_dashboard.sh new_dashboard 012345678901
 
# TODO 
Add script to generate dashboards
Add firmware images with battery service