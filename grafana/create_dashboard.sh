#!/bin/sh

if [ "$1" = '-h' ]
then  
  echo 'This script create a new dashboard with dashboard_name.dashboard from new sensortag'
  echo '   USAGE : create_dashboard.sh dashboard_name sensortag_uuid '
  echo '           sensortag_uuid can be found using sudo hcitool lescan command'
  echo '   EXAMPLE : create_dashboard.sh my_new_dashboard 1233aa4852a1'
  exit 0
fi  

if [ "$#" -ne 2 ]
then 
  echo 'Invalid number of arguments - refer -h option'
  exit 1
fi  

if ! echo $2 | grep -iE '^[0-9,a-f]{12}$' > /dev/null
then
  echo 'invalid sensortag uuid given : must be an hexa number of 12 length'
  exit 1
else
  sed -E "s/room 1/$1/;s/TI_ST_c4be84710a04/TI_ST_$2/" ./room_1_base.dashboard > "$1".dashboard
fi   

exit 0

